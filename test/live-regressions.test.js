import test from 'node:test';
import assert from 'node:assert/strict';
import { makeModelCaller } from '../src/model.js';
import { findMessageIndex, displayMessage } from '../src/native-display.js';
import { memoryEpisodes, recallBundle } from '../src/memory-view.js';
import { recordSharedEvents, validateSharedMemory } from '../src/shared-memory.js';
import { resolveStateChanges, validateStateChanges } from '../src/memory.js';
import { runTurn } from '../src/pipeline.js';
import { defaultConfig, COMBINATION, PLAN, TABLE_UPDATE, MEMORY } from '../src/contracts.js';

test('uncommitted native messages never match a greeting or unrelated hidden helper draft', () => {
  const state = { messages: [{ id: 'greeting', role: 'assistant', content: 'Welcome' }], helperChat: [{ is_system: true, mes: '' }] };
  for (const role of ['user', 'assistant']) {
    const index = findMessageIndex(state, undefined, 'A new message', role);
    assert.equal(index, -1);
    assert.deepEqual(displayMessage(state, state.messages[index], 'A new message'), { text: 'A new message', hidden: false });
  }
  state.messages.push({ id: 'new', nativeMessageId: 'native', role: 'user', content: 'A new message' });
  state.helperChat.push({ tavernMessageId: 'new', mes: 'Edited message', is_system: false });
  assert.equal(findMessageIndex(state, 'native', 'A new message', 'user'), 1);
  assert.equal(displayMessage(state, state.messages[1]).text, 'Edited message');
});

test('a silent provider stops once, preserves partial reasoning, and never starts another paid request', async () => {
  let count = 0, providerSignal; const attempts = [];
  const caller = makeModelCaller({ providerRetryPolicy: () => ({ mode: 'always', maxRetries: 3, retryableCodes: [] }),
    stream: async function* ({ signal }) { count++; providerSignal = signal; yield { type: 'reasoning-delta', index: 0, text: 'partial reasoning' }; await new Promise(() => {}); },
  }, { toolTimeoutMs: 200, toolIdleMs: 15 });
  await assert.rejects(caller({ agent: { provider: 'test', model: 'test' }, messages: [], schema: { type: 'object' }, onAttempt: record => attempts.push(record) }), { code: 'TAVERN_TIMEOUT' });
  assert.equal(count, 1); assert.equal(providerSignal.aborted, true);
  assert.equal(attempts[0].response.reasoning, 'partial reasoning');
  assert.equal(attempts[0].status, 'failed'); assert.ok(attempts[0].elapsedMs >= 10);
});

test('continuous tool output still has an overall deadline and keeps partial arguments', async () => {
  const attempts = [];
  const caller = makeModelCaller({ stream: async function* ({ signal }) {
    while (!signal.aborted) { yield { type: 'tool-call-delta', index: 0, name: 'tavern_result', argumentsDelta: ' ' }; await new Promise(resolve => setTimeout(resolve, 2)); }
  } }, { toolTimeoutMs: 25, toolIdleMs: 100 });
  await assert.rejects(caller({ agent: { provider: 'test', model: 'test' }, messages: [], schema: { type: 'object' }, onAttempt: r => attempts.push(r) }), { code: 'TAVERN_TIMEOUT' });
  assert.ok(attempts[0].response.toolCalls[0].arguments.length > 0);
});

test('one public event has multiple private references; a private event is excluded from other recall lanes', () => {
  const state = { memories: { a: [], b: [], c: [] } };
  const result = { events: [
    { summary: '甲交还钥匙，乙目睹交接。', knownByCharacterIds: ['a', 'b'], evidence: { sourceId: 'shared' } },
    { summary: '甲在心中决定明日离职。', knownByCharacterIds: ['a'], evidence: { sourceId: 'private' } },
  ], characters: ['a', 'b', 'c'].map(characterId => ({ characterId, stateChanges: [] })) };
  validateSharedMemory(result, ['a', 'b', 'c'].map(id => ({ id })), () => {}, () => {});
  const records = recordSharedEvents(result, { state, turnId: 't', createdAt: 'now', sourceMessageIds: ['m'], resolveEvidence: e => ({ messageId: 'm', quote: e.sourceId }) });
  for (const record of records) state.memories[record.characterId].push({ ...record, id: record.characterId });
  assert.equal(state.memoryEvents.length, 2);
  assert.equal(state.memories.a[0].eventIds[0], state.memories.b[0].eventIds[0]);
  assert.deepEqual(state.memories.c[0].eventIds, []);
  assert.ok(!JSON.stringify(memoryEpisodes(state, 'b')).includes('离职'));
  const recalls = ['a', 'b'].map(characterId => ({ characterId, records: memoryEpisodes(state, characterId) }));
  const bundle = recallBundle(recalls);
  assert.equal(JSON.stringify(bundle).split('甲交还钥匙').length - 1, 1);
  assert.equal(bundle.characters[1].records[0].eventIds.length, 1);
  assert.throws(() => validateSharedMemory({ ...result, events: [{ ...result.events[0], knownByCharacterIds: ['outsider'] }] }, [{ id: 'a' }, { id: 'b' }, { id: 'c' }], () => {}, () => {}), /本次以外/);
});

test('an exact existing attribute name resolves locally within its owner while foreign ids still fail', () => {
  const current = [{ id: 'b-state', subject: '周川', key: '收到要求', value: '保管借阅证', op: 'set' }];
  const messages = [{ id: 'story', content: '周川只负责见证。' }], sources = [{ id: 'source-1', messageId: 'story', quote: messages[0].content }];
  const change = { op: 'set', target: { subject: '周川', key: '收到要求' }, value: '只负责见证', evidence: { sourceId: 'source-1' } };
  const resolved = resolveStateChanges([change], current, sources);
  assert.equal(resolved[0].previousFactId, 'b-state');
  assert.doesNotThrow(() => validateStateChanges(resolved, current, messages));
  assert.throws(() => resolveStateChanges([{ ...change, target: { id: 'other-character-id' } }], current, sources), /不是当前状态/);
});

test('a later single-character update still reads its shared event references', async () => {
  const scene = { location: '资料室', time: '上午', summary: '林岚在资料室。' };
  const state = { id: 'single-after-shared', config: defaultConfig(), messages: [], scene, tables: {}, variables: {},
    characters: [{ id: 'a', name: '林岚', profile: '成年档案管理员。' }],
    memoryEvents: [{ id: 'public', summary: '林岚和周川一起归还了银钥匙。', knownByCharacterIds: ['a', 'b'] }, { id: 'private', summary: '周川独自决定离职。', knownByCharacterIds: ['b'] }],
    memories: { a: [{ id: 'old', summary: '', facts: [], relationships: [], openThreads: [], stateChanges: [], eventIds: ['public'] }] } };
  let memoryCalls = 0;
  const result = await runTurn({ state, card: { name: '资料室' }, text: '林岚整理资料。', callModel: async ({ stage, schema, messages }) => {
    const input = schema ? JSON.parse(messages.at(-1).content) : {};
    if (stage === 'recall') return { characterId: 'a', memories: [{ id: 'old', relevance: 1 }], perspective: '', likelyPresent: true };
    if (schema === COMBINATION) return { scene, presentCharacterIds: ['a'], worldEntryIds: [], situation: '', characterViews: [], openThreads: [] };
    if (schema === PLAN) return { scene, beats: [], characterIntents: [], constraints: [] };
    if (schema === TABLE_UPDATE) return { scene, operations: [], worldChanges: [], participatingCharacters: [], newCharacters: [] };
    if (schema === MEMORY) {
      memoryCalls++;
      assert.ok(JSON.stringify(input.previousMemories).includes('一起归还了银钥匙'));
      assert.ok(!JSON.stringify(input.previousMemories).includes('离职'));
      return { characterId: 'a', summary: '', facts: [], relationships: [], openThreads: [], stateChanges: [] };
    }
    assert.equal(stage, 'write'); return '林岚整理好了资料。';
  } });
  assert.equal(result.pendingUpdates, undefined);
  assert.equal(memoryCalls, 1);
});
