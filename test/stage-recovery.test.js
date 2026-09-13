import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage.js';
import { openTurnCheckpoint, clearTurnCheckpoint } from '../src/turn-checkpoint.js';
import { parseResultText } from '../src/protocol-repair.js';
import { makeModelCaller } from '../src/model.js';
import { runTurn, resumeStoryUpdates } from '../src/pipeline.js';
import { defaultConfig } from '../src/contracts.js';

test('one protocol block with a preamble is accepted; ambiguous blocks and prose remain rejected', () => {
  assert.deepEqual(parseResultText('<dm_plan>准备选择已有索引。</dm_plan>\n<tavern_result>{"sections":{"recall":"AM0001"},"selectedRecords":[]}</tavern_result>'), { found: true, value: { sections: { recall: 'AM0001' }, selectedRecords: [] } });
  for (const text of ['普通说明 {"a":1}', '<tavern_result>{}</tavern_result><tavern_result>{}</tavern_result>', '<tavern_result>{}<tavern_result></tavern_result>', '<tavern_result>broken</tavern_result>']) assert.equal(parseResultText(text).found, false);
});

test('completed reasoning-only writer response is stored and never automatically replayed', async () => {
  let calls = 0, reasoning; const records = [];
  const call = makeModelCaller({ providerRetryPolicy: () => ({ mode: 'always', maxRetries: 3, retryableCodes: [], initialDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 }), stream: async function* () {
    calls++; yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: '准备整理图书的构思。' } };
    yield { type: 'usage', usage: { inputTokens: 51000, outputTokens: 100 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } });
  await assert.rejects(call({ agent: { provider: 'test', model: 'test' }, messages: [{ role: 'user', content: '整理图书' }], onReasoning: value => { reasoning = value; }, onAttempt: record => records.push(record) }), /仅返回了思考/);
  assert.equal(calls, 1); assert.equal(reasoning, '准备整理图书的构思。');
  assert.equal(records[0].response.reasoning, reasoning);
  assert.deepEqual(records[0].input.messages, [{ role: 'user', content: '整理图书' }]);
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'tavern-recovery-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new Store(root); await store.init();
  const state = { id: 'recovery', turn: 1, revision: 'unchanged', userName: '访客', config: defaultConfig({ provider: 'test', model: 'test' }),
    messages: [{ id: 'old', role: 'assistant', content: '林岚在整理图书。' }], tables: {}, variables: {}, scene: { location: '图书馆', time: '下午', summary: '整理图书' },
    characters: [{ id: 'a', name: '林岚', profile: '成年管理员。' }], memories: { a: [{ id: 'm1', summary: '周五闭馆。', facts: [], relationships: [], openThreads: [] }] } };
  const assets = { card: { name: '图书馆' }, legacy: { plotTasks: [{ name: '推进', extractTags: 'outline', promptGroup: [{ role: 'system', content: '简短规划。' }, { role: 'user', content: '$7 $8' }] }] } };
  return { store, state, assets, text: '继续整理。' };
}

for (const failedStage of ['advance', 'write', 'table', 'memory']) test(`retry resumes only unfinished stages after ${failedStage} failure, including across restart`, async t => {
  const args = await fixture(t), original = structuredClone(args.state), charged = [], reused = [];
  let failing = true;
  const model = async request => {
    charged.push(request.stage);
    if (failing && request.stage === failedStage) throw new Error('injected stage failure');
    request.onUsage?.({ inputTokens: 10, outputTokens: 1 });
    const input = ['table', 'memory', 'recall'].includes(request.stage) ? JSON.parse(request.messages.at(-1).content) : null;
    if (request.stage === 'recall') return { characterId: 'a', memories: [], perspective: '整理员视角', likelyPresent: true };
    if (request.stage === 'advance') return { sections: { outline: '核对还书日期。' } };
    if (request.stage === 'write') { request.onReasoning?.('保留写作构思。'); return '林岚确认周五闭馆。'; }
    if (request.stage === 'table') return { operations: [], worldChanges: [], scene: args.state.scene, participatingCharacters: [{ characterId: 'a', evidence: { sourceId: input.sourcePassages.at(-1).passages[0].id } }], newCharacters: [] };
    if (request.stage === 'memory') return { characterId: 'a', summary: '确认周五闭馆。', facts: [], relationships: [], openThreads: [], stateChanges: [] };
    throw new Error('Unexpected ' + request.stage);
  };
  const run = async () => {
    const checkpoint = await openTurnCheckpoint({ ...args, store: new Store(args.store.root) });
    const resume = checkpoint.wrap(model);
    return runTurn({ state: args.state, ...args.assets, text: args.text, runIdentity: checkpoint.identity,
      callModel: request => resume({ ...request, onRequest: value => { if (value.reused) reused.push(request.stage); request.onRequest?.(value); } }) });
  };
  let partial;
  if (['table', 'memory'].includes(failedStage)) {
    partial = await run();
    assert.match(partial.pendingUpdates.error, /injected stage failure/);
    assert.equal(partial.turn, 2);
    assert.equal(partial.messages.at(-1).content, '林岚确认周五闭馆。');
    assert.deepEqual(partial.memories, original.memories);
    partial = await args.store.saveSession(partial);
  } else await assert.rejects(run(), /injected stage failure/);
  assert.deepEqual(args.state, original);
  const before = charged.slice(); failing = false;
  const result = partial ? await resumeStoryUpdates({ state: await new Store(args.store.root).session(partial.id), ...args.assets, callModel: model }) : await run();
  if (!partial) assert.deepEqual(reused, before.slice(0, -1));
  assert.equal(result.pendingUpdates, undefined);
  for (const stage of before.slice(0, -1)) assert.equal(charged.filter(value => value === stage).length, 1);
  assert.equal(charged.filter(value => value === failedStage).length, 2);
  assert.equal(result.turn, 2); assert.equal(result.memories.a.length, 2);
  assert.equal(result.messages.at(-1).extra.reasoning, '保留写作构思。');
  for (const record of result.lastRun.trace.filter(record => reused.includes(record.stage))) assert.deepEqual(record.usage, []);
  assert.equal((await stat(join(args.store.sessionDir(args.state.id), 'turn-checkpoint.json'))).mode & 0o777, 0o600);
});

test('checkpoint invalidates changed input, state, assets, route and schema; commit clears it', async t => {
  const args = await fixture(t); let count = 0;
  const options = { stage: 'advance', agent: { model: 'one' }, messages: [{ role: 'user', content: 'unchanged' }] };
  const invoke = async (input, request = options) => (await openTurnCheckpoint(input)).wrap(async () => { count++; return 'ok'; })(request);
  await invoke(args); await invoke(args); assert.equal(count, 1);
  await invoke({ ...args, state: { ...args.state, revision: 'another', updatedAt: 'later' } }); assert.equal(count, 1);
  for (const input of [{ ...args, text: 'changed' }, { ...args, state: { ...args.state, variables: { changed: true } } }, { ...args, assets: { ...args.assets, card: { name: 'changed' } } }, { ...args, state: { ...args.state, id: 'another-session' } }]) { const n = count; await invoke(input); assert.equal(count, n + 1); }
  await invoke(args); const n = count;
  await invoke(args, { ...options, agent: { model: 'two' } }); assert.equal(count, n + 1);
  await clearTurnCheckpoint(args.store, args.state.id); await invoke(args); assert.equal(count, n + 2);
});
