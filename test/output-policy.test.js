import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { withoutOutputLimit } from '../src/output-policy.js';
import { makeModelCaller } from '../src/model.js';
import { runTurn } from '../src/pipeline.js';
import { defaultConfig, validateConfig, COMBINATION, PLAN, TABLE_UPDATE } from '../src/contracts.js';
import { writingLengthInstruction } from '../src/writing-length.js';

async function receiver(t) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    requests.push({ path: request.url, body: JSON.parse(Buffer.concat(chunks)), headers: request.headers });
    response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"ok":true}');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const send = (path, body) => fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  return { requests, origin, send };
}

test('wire omission removes SDK defaults for Tavern and preserves simultaneous native requests', async t => {
  const { requests, send } = await receiver(t), changes = [];
  const body = { model: 'fixture', messages: [{ role: 'user', content: '原样输入' }], max_tokens: 32768, reasoning_effort: 'high', thinking: { type: 'enabled' }, stream: true };
  await Promise.all([
    withoutOutputLimit(async () => { await new Promise(resolve => setImmediate(resolve)); return send('/v1/chat/completions', body); }, value => changes.push(value)),
    send('/v1/chat/completions', { ...body, model: 'native' }),
  ]);
  const tavern = requests.find(r => r.body.model === 'fixture').body, native = requests.find(r => r.body.model === 'native').body;
  assert.deepEqual(tavern, Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'max_tokens')));
  assert.equal(native.max_tokens, 32768); assert.equal(body.max_tokens, 32768);
  assert.deepEqual(changes, [{ protocol: 'chat-completions', removed: { max_tokens: 32768 } }]);
});

test('request rewriting handles Responses and Request objects without losing headers or cancellation', async t => {
  const { requests, origin } = await receiver(t), abort = new AbortController();
  const input = new Request(origin + '/v1/responses', { method: 'POST', signal: abort.signal,
    headers: { 'content-type': 'application/json', 'x-fixture': 'preserved' },
    body: JSON.stringify({ model: 'fixture', input: '保留输入', max_output_tokens: 100, max_completion_tokens: 100 }) });
  await withoutOutputLimit(() => fetch(input).then(r => r.json()));
  assert.deepEqual(requests[0].body, { model: 'fixture', input: '保留输入' });
  assert.equal(requests[0].headers['x-fixture'], 'preserved');
  abort.abort();
  await assert.rejects(withoutOutputLimit(() => fetch(new Request(origin + '/v1/chat/completions', { method: 'POST', signal: abort.signal, body: JSON.stringify({ model: 'fixture', messages: [], max_tokens: 100 }) }))), { name: 'AbortError' });
});

test('unrelated endpoints and protocols with a required max_tokens remain intact', async t => {
  const { requests, send } = await receiver(t);
  const body = { model: 'fixture', messages: [], max_tokens: 1024 };
  await withoutOutputLimit(async () => {
    await send('/v1/messages', body); await send('/api/settings', body);
    await send('/v1/chat/completions', { value: 'not a model request', max_tokens: 42 });
  });
  assert.deepEqual(requests.map(r => r.body.max_tokens), [1024, 1024, 42]);
});

test('wire rewriting preserves a per-request proxy dispatcher', async () => {
  let dispatched = 0;
  const dispatcher = { dispatch() { dispatched++; throw new Error('fixture dispatcher reached'); } };
  await assert.rejects(withoutOutputLimit(() => fetch('http://127.0.0.1:8089/v1/chat/completions', { dispatcher, method: 'POST', body: JSON.stringify({ model: 'fixture', messages: [], max_tokens: 32768 }) })), error => error.cause?.message === 'fixture dispatcher reached');
  assert.equal(dispatched, 1);
});

test('real stream consumption removes an adapter cap and retains long reasoning, prose and tool arguments', async t => {
  const { requests, send } = await receiver(t);
  const reasoning = '核对资料。'.repeat(20000), prose = '正文继续。'.repeat(10000);
  const records = [], texts = [];
  const caller = makeModelCaller({ async *stream(options) {
    assert.ok(!Object.hasOwn(options, 'maxTokens'));
    // Emulate the downstream adapter's default after plugin-to-SDK options.
    await send('/v1/chat/completions', { model: 'fixture', messages: [], max_completion_tokens: 32768 });
    yield { type: 'reasoning-delta', index: 0, text: reasoning };
    if (options.tools) yield { type: 'tool-call-delta', index: 1, name: 'tavern_result', argumentsDelta: JSON.stringify({ value: prose }) };
    else yield { type: 'text-delta', index: 1, text: prose };
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 100000, totalTokens: 100010 } };
    yield { type: 'finish', reason: { kind: options.tools ? 'tool-calls' : 'stop' } };
  } });
  const agent = { provider: 'fixture', model: 'fixture', maxTokens: 20 };
  let savedReasoning;
  assert.equal(await caller({ agent, messages: [], onText: value => texts.push(value), onReasoning: value => { savedReasoning = value; }, onAttempt: record => records.push(record) }), prose);
  assert.equal(savedReasoning, reasoning); assert.equal(texts.join(''), prose);
  assert.deepEqual(await caller({ agent, messages: [], schema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] }, onAttempt: record => records.push(record) }), { value: prose });
  assert.equal(requests.length, 2);
  assert.ok(requests.every(r => !Object.hasOwn(r.body, 'max_completion_tokens')));
  assert.ok(records.every(r => r.input.outputPolicy.pluginLimit === 'none' && r.input.outputPolicy.wire[0].removed.max_completion_tokens === 32768 && r.response.reasoning === reasoning));
});

for (const playMode of ['agent', 'normal']) test(`${playMode} writes a stable prose-only target after frontend prompt preparation, without truncating output`, async () => {
  const config = { ...defaultConfig({ provider: 'fixture', model: 'fixture' }), playMode, writingMinChars: 80, writingMaxChars: 120 };
  const scene = { location: '图书馆', time: '上午', summary: '' };
  const state = { id: 'output-target', config, scene, characters: [], memories: {}, messages: [], tables: {}, variables: {}, renderMode: 'text' };
  const story = '管理员向访客介绍图书馆。'.repeat(300);
  for (const text of ['参观图书馆', '归还书籍']) {
    const result = await runTurn({ state, text, card: { name: '图书馆' },
      beforeWrite: async () => ({ messages: [{ role: 'system', content: '固定预设' }, { role: 'user', content: text }] }),
      callModel: async ({ stage, messages, schema }) => {
        if (schema === COMBINATION) return { scene, presentCharacterIds: [], worldEntryIds: [], situation: '', characterViews: [], openThreads: [] };
        if (schema === PLAN) return { scene, beats: [], characterIntents: [], constraints: [] };
        if (schema === TABLE_UPDATE) return { scene, operations: [], worldChanges: [], participatingCharacters: [], newCharacters: [] };
        assert.equal(stage, 'write');
        assert.deepEqual(messages, [{ role: 'system', content: writingLengthInstruction(config) + '\n\n固定预设' }, { role: 'user', content: text }]);
        assert.match(messages[0].content, /80–120 字/); assert.match(messages[0].content, /思考长度不受此区间限制/);
        return story;
      },
    });
    assert.equal(result.messages.at(-1).content, story);
  }
});

test('old configuration gains a prose target, validates ordering, and accepts arbitrarily large targets', () => {
  const config = defaultConfig(); delete config.writingMinChars; delete config.writingMaxChars;
  validateConfig(config); assert.equal(config.writingMinChars, 2000); assert.equal(config.writingMaxChars, 4000);
  assert.throws(() => validateConfig({ ...config, writingMinChars: 4001 }), /下限不能大于上限/);
  assert.throws(() => validateConfig({ ...config, writingMinChars: 1.5 }));
  validateConfig({ ...config, writingMaxChars: 10000000 });
});
