import test from 'node:test';
import assert from 'node:assert/strict';
import { makeModelCaller } from '../src/model.js';
import { decodeProtocol, validateProtocol, ProtocolError, MEMORY, PLAN, defaultConfig, validateConfig } from '../src/contracts.js';

const agent = { provider: 'fixture', model: 'fixture' };
const textOf = options => options.messages.map(m => m.content.map(b => b.text ?? '').join('')).join('\n');
const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
const make = (outputs, policy) => {
  const requests = [];
  const caller = makeModelCaller({ providerRetryPolicy: policy ? () => policy : undefined, stream: async function* (options) {
    requests.push(options); const response = outputs[Math.min(requests.length - 1, outputs.length - 1)];
    if (response instanceof Error) throw response;
    if (response.text) yield { type: 'text-delta', text: response.text };
    for (const [index, block] of (response.blocks ?? []).entries()) yield { type: 'block-end', index, block };
    if (response.usage) yield { type: 'usage', usage: response.usage };
    yield { type: 'finish', reason: response.finish ?? { kind: 'stop' } };
  } });
  return { caller, requests };
};
const tool = value => ({ blocks: [{ type: 'tool-call', name: 'tavern_result', arguments: typeof value === 'string' ? value : JSON.stringify(value) }] });

for (const value of ['{"ok":true}', '```json\n{"ok":true}\n```', '<tavern_result>{"ok":true}</tavern_result>']) test('a whole valid JSON envelope needs no second model request: ' + value.slice(0, 16), async () => {
  const { caller, requests } = make([{ text: value }]); const attempts = [];
  assert.deepEqual(await caller({ agent, schema, messages: [], onAttempt: record => attempts.push(record) }), { ok: true });
  assert.equal(requests.length, 1); assert.equal(attempts[0].kind, 'normalized');
});

for (const response of [{ text: 'I cannot comply with that request.' }, { text: '普通文本但没有数据结构' }, { text: '', finish: { kind: 'refusal' } }]) test('refusal/ordinary prose stops immediately and retains raw response', async () => {
  const { caller, requests } = make([response]); const attempts = [];
  await assert.rejects(caller({ agent, schema, messages: [], retries: 3, onAttempt: record => attempts.push(record) }), ProtocolError);
  assert.equal(requests.length, 1); assert.equal(attempts[0].status, 'failed'); assert.equal(attempts[0].response.text, response.text);
});

test('missing nested plan fields use one small grounded repair, not the original large prompt', async () => {
  const character = { characterId: 'actor-1', intent: 'Return the book', knowledgeBoundary: 'Only witnessed facts' };
  const partial = { scene: { location: 'Library', time: 'Evening', summary: 'A book return' }, beats: ['Return a book'] };
  const complete = { ...partial, characterIntents: [character], constraints: ['No invented memories'] };
  const { caller, requests } = make([tool(partial), tool(complete)]);
  const result = await caller({ agent, schema: PLAN, messages: [{ role: 'system', content: 'LONG_LORE'.repeat(20000) }], repairContext: { allowedCharacters: [character] }, retries: 3 });
  assert.deepEqual(result, complete); assert.equal(requests.length, 2);
  assert.ok(textOf(requests[1]).length < textOf(requests[0]).length / 20);
  assert.ok(!textOf(requests[1]).includes('LONG_LORE')); assert.match(textOf(requests[1]), /actor-1/);
  assert.deepEqual(requests[0].tools, requests[1].tools);
});

test('string-array errors are repaired locally with evidence and content preserved', async () => {
  const original = { characterId: 'a', summary: 'A librarian returned a book.', facts: 'One fact\nwith its exact wording', relationships: 'Coworker', openThreads: [], stateChanges: [] };
  const { caller, requests } = make([tool(original)]); const attempts = [];
  const result = await caller({ agent, schema: MEMORY, messages: [], onAttempt: record => attempts.push(record) });
  assert.deepEqual(result, { ...original, facts: [original.facts], relationships: [original.relationships] });
  assert.equal(requests.length, 1); assert.equal(attempts[0].normalization.changes.length, 2);
});

test('invalid repaired output is rejected; no repeated large or small loops', async () => {
  const { caller, requests } = make([tool({}), tool({})]);
  await assert.rejects(caller({ agent, schema, messages: [{ role: 'user', content: 'GROUNDING' }], retries: 3 }), ProtocolError);
  assert.equal(requests.length, 2);
});

test('a valid schema cannot bypass character-ownership validation', async () => {
  const shape = { type: 'object', properties: { characterId: { type: 'string' } }, required: ['characterId'] };
  const { caller, requests } = make([tool({ characterId: 'wrong' }), tool({ characterId: 'wrong' })]);
  await assert.rejects(caller({ agent, schema: shape, messages: [], repairContext: { characterId: 'right' }, validate: result => { if (result.characterId !== 'right') throw new ProtocolError('wrong owner'); } }), /wrong owner/);
  assert.equal(requests.length, 2);
});

test('output truncation fails without repeating an identical output limit', async () => {
  const { caller, requests } = make([{ ...tool('{"ok":'), finish: { kind: 'length' } }]);
  await assert.rejects(caller({ agent: { ...agent, maxTokens: 20 }, schema, messages: [] }), ProtocolError); assert.equal(requests.length, 1);
});

test('multiple tools and wrong tools remain invalid', async () => {
  for (const blocks of [[...tool({ ok: true }).blocks, ...tool({ ok: true }).blocks], [{ type: 'tool-call', name: 'not_tavern_result', arguments: '{"ok":true}' }]]) {
    const { caller, requests } = make([{ blocks }]);
    await assert.rejects(caller({ agent, schema, messages: [], retries: 3 }), ProtocolError); assert.equal(requests.length, 1);
  }
});

test('zero retries remains zero network repairs', async () => {
  const { caller, requests } = make([tool({}), tool({ ok: true })]);
  await assert.rejects(caller({ agent, schema, messages: [], retries: 0 }), ProtocolError); assert.equal(requests.length, 1);
});

test('provider always mode still respects its transport retry ceiling', async () => {
  const failure = new Error('offline failure'); failure.code = 'TRANSPORT';
  const { caller, requests } = make([failure], { mode: 'always', maxRetries: 2, initialDelayMs: 0, maxDelayMs: 0, jitterRatio: 0, retryableCodes: [] });
  await assert.rejects(caller({ agent, schema, messages: [] }), /offline failure/); assert.equal(requests.length, 3);
});

test('partial writer output is not replayed after a transport error', async () => {
  let count = 0; const chunks = [];
  const caller = makeModelCaller({ providerRetryPolicy: () => ({ mode: 'always', maxRetries: 2, retryableCodes: [] }), stream: async function* () { count++; yield { type: 'text-delta', text: 'Partial prose.' }; throw new Error('disconnect'); } });
  await assert.rejects(caller({ agent, messages: [], onText: t => chunks.push(t) }), /disconnect/);
  assert.equal(count, 1); assert.deepEqual(chunks, ['Partial prose.']);
});

test('writer content, reasoning, sampling and usage stay unchanged while legacy caps are omitted', async () => {
  const prose = '完整正文。\n😀', reasoning = '核对人物与时间。';
  const usage = { inputTokens: 12, outputTokens: 8, cacheReadTokens: 100, totalTokens: 120 };
  const { caller, requests } = make([{ text: prose, blocks: [{ type: 'reasoning', text: reasoning }], usage }]);
  let savedReasoning; const seenUsage = [], seenAudit = [];
  const original = [{ role: 'system', content: '原始写作要求' }, { role: 'user', content: '原始输入' }];
  const output = await caller({ agent: { ...agent, reasoningEffort: 'high', temperature: .9, maxTokens: 6000 }, sessionId: 'stable-session', messages: original,
    onReasoning: r => { savedReasoning = r; }, onUsage: u => seenUsage.push(u), onRequest: r => seenAudit.push(r) });
  assert.equal(output, prose); assert.equal(savedReasoning, reasoning); assert.deepEqual(seenUsage, [usage]);
  assert.equal(requests[0].reasoningEffort, 'high'); assert.ok(!Object.hasOwn(requests[0], 'maxTokens')); assert.equal(requests[0].temperature, .9); assert.equal(requests[0].sessionId, 'stable-session');
  assert.deepEqual(requests[0].messages.map(m => ({ role: m.role, content: m.content[0].text })), original);
  assert.equal(seenAudit[0].kind, 'local-input-audit-not-provider-cache');
});

test('tool contract is in the first retained system message and includes nested required fields', async () => {
  const output = { scene: { location: '', time: '', summary: '' }, beats: [], characterIntents: [], constraints: [] };
  const { caller, requests } = make([tool(output)]);
  await caller({ agent, schema: PLAN, messages: [{ role: 'user', content: 'PERSONA_PRELUDE' }, { role: 'system', content: 'LATE_SYSTEM' }] });
  assert.equal(requests[0].messages[0].role, 'system'); assert.match(requests[0].messages[0].content[0].text, /characterIntents/); assert.match(requests[0].messages[0].content[0].text, /constraints/);
});

test('old config gains focused default and compatibility mode validates', () => {
  const old = defaultConfig(); delete old.toolContextMode; assert.equal(validateConfig(old).toolContextMode, 'focused');
  old.toolContextMode = 'full'; assert.equal(validateConfig(old).toolContextMode, 'full');
});

test('extra fields and number/string type errors are not silently discarded', () => {
  assert.throws(() => validateProtocol({ ok: true, extra: 1 }, schema), ProtocolError);
  assert.throws(() => decodeProtocol({ toolCalls: tool({ ok: 1 }).blocks, text: '' }, schema), ProtocolError);
});

test('internal model calls preserve affinity but cannot re-enter the outer tavern orchestrator', async () => {
  const { caller, requests } = make([tool({ ok: true })]);
  await caller({ agent, schema, messages: [], sessionId: 'same-as-native-agent' });
  assert.equal(requests[0].sessionId, 'same-as-native-agent');
  assert.equal(requests[0].purpose, 'tavern.model');
});

test('permanent authorization failures are not retried even under provider always policy', async () => {
  const error = Object.assign(new Error('Unauthorized'), { code: 'AUTH' });
  const { caller, requests } = make([error], { mode: 'always', maxRetries: 3, retryableCodes: [], initialDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 });
  await assert.rejects(caller({ agent, schema, messages: [] }), /Unauthorized/);
  assert.equal(requests.length, 1);
});
