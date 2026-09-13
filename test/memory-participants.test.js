import { sourcePassages } from './helpers/tool-context.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/pipeline.js';
import { defaultConfig, COMBINATION, PLAN, MEMORY, TABLE_UPDATE, validateProtocol } from '../src/contracts.js';
import { currentFacts } from '../src/memory.js';
import { Store } from '../src/storage.js';

const scene = { location: '资料室', time: '上午', summary: '访客归还地图。' };
const card = { name: '城市档案馆', description: '开放参观的档案馆。' };

test('runTurn schedules the registered first participant from a solitary opening exactly once', async () => {
  const character = { id: 'archivist-47', name: '叶衡', profile: '成年档案管理员。' };
  const state = { id: 'first-participant', userName: '访客', config: defaultConfig(), messages: [], scene: { location: '', time: '', summary: '' }, tables: {}, variables: {}, characters: [character], memories: { [character.id]: [] } };
  const before = structuredClone(state);
  const story = '叶衡从资料室走出来，接过访客归还的地图。';
  const memoryCalls = [];
  const result = await runTurn({ state, card, text: '我走进档案馆。', callModel: async ({ stage, schema, messages }) => {
    const input = schema ? JSON.parse(messages.at(-1).content) : {};
    if (schema === COMBINATION) return { scene: state.scene, presentCharacterIds: [], worldEntryIds: [], situation: '开场无人。', characterViews: [], openThreads: [] };
    if (schema === PLAN) return { scene, beats: ['叶衡可能来接收地图。'], characterIntents: [], constraints: [] };
    if (schema === TABLE_UPDATE) {
      const response = { scene, operations: [], worldChanges: [], newCharacters: [], participatingCharacters: [{ characterId: character.id, evidence: { sourceId: sourcePassages(input).at(-1).id } }] };
      // The fixture emits the advertised tool fields, so the old contract reaches the missing-call assertion.
      return Object.fromEntries(Object.keys(schema.properties).map(key => [key, response[key]]));
    }
    if (schema === MEMORY) {
      memoryCalls.push(input.character.id);
      return { characterId: input.character.id, summary: '接过访客归还的地图。', facts: ['已收回地图'], relationships: [], openThreads: [], stateChanges: [{ op: 'set', target: { subject: '地图', key: '保管人' }, value: character.name, evidence: { sourceId: sourcePassages(input).at(-1).id } }] };
    }
    assert.equal(stage, 'write');
    return story;
  } });
  assert.deepEqual(memoryCalls, [character.id]);
  assert.equal(result.memories[character.id].length, 1);
  const memory = result.memories[character.id][0];
  assert.equal(memory.summary, '接过访客归还的地图。');
  assert.deepEqual(memory.facts, ['已收回地图']);
  assert.deepEqual(memory.sourceMessageIds, result.messages.map(message => message.id));
  assert.equal(memory.turnId, result.lastRun.id);
  assert.equal(currentFacts(result.memories[character.id])[0].value, character.name);
  assert.deepEqual(memory.stateChanges[0].evidence, { messageId: result.messages.at(-1).id, quote: story });
  assert.equal(result.characters.length, 1);
  assert.deepEqual(state, before);
});

function ensemble() {
  const characters = [
    { id: 'host', name: '许澈', profile: '成年管理员。' },
    { id: 'arrival', name: 'Elian', profile: '成年轮值档案员。' },
    { id: 'remote', name: '白杉', profile: '成年库管员，通过电话联系。' },
    { id: 'planned', name: '杜禾', profile: '明天值班的成年管理员。' },
    { id: 'mentioned', name: 'Noor', profile: '名册中的成年访客。' },
    { id: 'disabled', name: 'Quinn', profile: '成年馆员。', enabled: false },
  ];
  const paragraphs = [
    '许澈接过访客归还的地图，放进资料柜。',
    '轮值的档案员来到柜台，亲眼看见地图已放进资料柜。',
    '白杉接通电话。许澈告诉她地图已经放进资料柜，她确认听清了。',
    'Mira 自我介绍是成年修复师，承诺明早修复地图。',
    '名册上还有 Noor 的名字。杜禾的值班安排在明天，她尚未收到地图归还的消息。',
  ];
  const actualIds = ['host', 'arrival', 'remote'];
  const state = { id: 'ensemble-participants', userName: '访客', config: defaultConfig(), messages: [], scene, tables: {}, variables: {}, characters,
    memories: Object.fromEntries(characters.map(character => [character.id, [{ id: `private-${character.id}`, summary: `${character.name}独自整理过书签。`, facts: [], relationships: [], openThreads: [], stateChanges: [] }]])) };
  state.config.concurrency = 3;
  state.characters[1].memoryModel = { provider: 'fixture', model: 'arrival-memory' };
  const calls = [];
  const callModel = async ({ stage, schema, messages, agent }) => {
    const input = schema ? JSON.parse(messages.at(-1).content) : {};
    calls.push({ stage, input, agent });
    if (stage === 'recall') {
      assert.deepEqual(input.memories.map(memory => memory.id), [`private-${input.character.id}`]);
      return { characterId: input.character.id, memories: [{ id: input.memories[0].id, relevance: 1 }], perspective: '', likelyPresent: false };
    }
    if (schema === COMBINATION) return { scene, presentCharacterIds: ['host', 'planned'], worldEntryIds: [], situation: '归还地图。', characterViews: [], openThreads: [] };
    if (schema === PLAN) return { scene, beats: ['轮值档案员可能加入；杜禾可能来收地图。'], characterIntents: [{ characterId: 'planned', intent: '收地图', knowledgeBoundary: '尚不知情' }], constraints: [] };
    if (stage === 'write') return paragraphs.join('\n');
    const sources = sourcePassages(input).filter(source => source.messageId === sourcePassages(input).at(-1).messageId);
    if (schema === TABLE_UPDATE) {
      assert.equal(input.completedStoryMessageId, sources[0].messageId);
      assert.deepEqual(input.characters.map(character => character.enabled), [true, true, true, true, true, false]);
      return { scene, operations: [], worldChanges: [], participatingCharacters: actualIds.map((characterId, index) => ({ characterId, evidence: { sourceId: sources[index].id } })), newCharacters: [{ name: 'Mira', profile: '成年修复师。', evidence: { sourceId: sources[3].id } }] };
    }
    assert.equal(schema, MEMORY);
    const id = input.character.id, index = actualIds.indexOf(id);
    assert.ok(input.previousMemories.every(memory => memory.summary === `${input.character.name}独自整理过书签。`));
    if (id === 'planned') return { characterId: id, summary: '', facts: [], relationships: [], openThreads: [], stateChanges: [] };
    const value = index < 0 ? '明早修复地图' : '地图已放进资料柜';
    return { characterId: id, summary: value, facts: [value], relationships: [], openThreads: [], stateChanges: [{ op: 'set', target: { subject: '地图', key: index < 0 ? '修复承诺' : '已知存放位置' }, value, evidence: { sourceId: sources[index < 0 ? 3 : index].id } }] };
  };
  return { state, card, text: '我希望杜禾来收地图。', callModel, calls, paragraphs };
}

test('Existing arrivals, remote participants and a truly new character each get one isolated memory; plans and mentions stay empty', async () => {
  const fixture = ensemble(), before = structuredClone(fixture.state);
  const result = await runTurn(fixture);
  const added = result.characters.find(character => character.name === 'Mira');
  assert.ok(added?.id);
  const memoryCalls = fixture.calls.filter(call => call.stage === 'memory');
  assert.deepEqual(memoryCalls.map(call => call.input.character.id), ['host', 'planned', 'arrival', 'remote', added.id]);
  assert.equal(memoryCalls.find(call => call.input.character.id === 'arrival').agent.model, 'arrival-memory');
  assert.equal(fixture.calls.filter(call => call.stage === 'table').length, 1);
  for (const [id, index] of [['host', 0], ['arrival', 1], ['remote', 2], [added.id, 3]]) {
    const memory = result.memories[id].at(-1), fact = currentFacts(result.memories[id])[0];
    assert.equal(result.memories[id].length, id === added.id ? 1 : 2);
    assert.equal(memory.characterId, id);
    assert.equal(memory.turnId, result.lastRun.id);
    assert.equal(fact.turnId, result.lastRun.id);
    assert.deepEqual(memory.sourceMessageIds, result.messages.map(message => message.id));
    assert.deepEqual(fact.evidence, { messageId: result.messages.at(-1).id, quote: fixture.paragraphs[index] });
    assert.equal(fact.value, id === added.id ? '明早修复地图' : '地图已放进资料柜');
  }
  for (const id of ['planned', 'mentioned', 'disabled']) assert.deepEqual(result.memories[id], before.memories[id]);
  assert.deepEqual(added.evidence, { messageId: result.messages.at(-1).id, quote: fixture.paragraphs[3] });
  assert.deepEqual(fixture.state, before);
});

test('Continue uses only its new assistant floor for participant evidence and memory sourceMessageIds', async () => {
  const fixture = ensemble();
  fixture.state.messages.push({ id: 'previous-assistant', role: 'assistant', content: '档案馆刚开门。' });
  const result = await runTurn({ ...fixture, trigger: 'continue', text: '' });
  assert.equal(result.messages.length, 2);
  for (const call of fixture.calls.filter(call => call.stage === 'memory')) {
    assert.ok(sourcePassages(call.input).every(source => source.messageId === result.messages.at(-1).id));
    const memory = result.memories[call.input.character.id].at(-1);
    if (call.input.character.id !== 'planned') assert.deepEqual(memory.sourceMessageIds, [result.messages.at(-1).id]);
  }
});

test('Recall, initial memory plus table, and supplemental memories retain bounded parallel execution', { timeout: 10000 }, async t => {
  const fixture = ensemble(), groups = new Map(), active = new Map();
  const gate = (group, expected) => {
    if (!groups.has(group)) {
      let release;
      const promise = new Promise(resolve => { release = resolve; });
      const timer = setTimeout(release, 2000);
      t.after(() => clearTimeout(timer));
      groups.set(group, { count: 0, release, promise });
    }
    const entry = groups.get(group);
    entry.count++;
    if (entry.count === expected) entry.release();
    return entry.promise.then(() => assert.equal(entry.count, expected, `${group} must overlap`));
  };
  const result = await runTurn({ ...fixture, callModel: async request => {
    const input = request.schema ? JSON.parse(request.messages.at(-1).content) : {};
    const group = request.stage === 'recall' ? 'recall' : request.stage === 'table' || (request.stage === 'memory' && ['host', 'planned'].includes(input.character.id)) ? 'initial' : request.stage === 'memory' ? 'supplemental' : null;
    if (group) {
      active.set(group, (active.get(group) ?? 0) + 1);
      assert.ok(active.get(group) <= fixture.state.config.concurrency);
      if (group !== 'recall' || groups.get(group)?.count < 3 || !groups.has(group)) await gate(group, 3);
    }
    try { return await fixture.callModel(request); }
    finally { if (group) active.set(group, active.get(group) - 1); }
  } });
  assert.equal(result.turn, 1);
  assert.deepEqual([...groups].map(([name, value]) => [name, value.count]), [['recall', 3], ['initial', 3], ['supplemental', 3]]);
});

test('Participant protocol rejects missing fields, malformed evidence and extra properties', () => {
  const participant = { characterId: 'known', evidence: { sourceId: 'source-2' } };
  const valid = { scene, operations: [], worldChanges: [], participatingCharacters: [participant], newCharacters: [] };
  assert.equal(validateProtocol(valid, TABLE_UPDATE), valid);
  for (const participatingCharacters of [null, ['known'], [{ characterId: 'known' }], [{ ...participant, characterId: '' }], [{ ...participant, evidence: { sourceId: '' } }], [{ ...participant, evidence: { sourceId: 'source-2', quote: 'invented' } }], [{ ...participant, name: 'unrequested' }]]) {
    assert.throws(() => validateProtocol({ ...valid, participatingCharacters }, TABLE_UPDATE), { name: 'ProtocolError' });
  }
  const missing = { ...valid }; delete missing.participatingCharacters;
  assert.throws(() => validateProtocol(missing, TABLE_UPDATE), /participatingCharacters/);
});

test('Invalid participants, duplicate identities and supplemental memory failures cannot commit a partial turn', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tavern-participant-failure-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(directory); await store.init();
  const cases = [
    ['unknown participant', 'table', (value) => { value.participatingCharacters[1].characterId = 'unknown'; }, /正文参与角色.*不存在/],
    ['disabled participant', 'table', (value) => { value.participatingCharacters[1].characterId = 'disabled'; }, /正文参与角色.*不存在/],
    ['duplicate participant', 'table', (value) => { value.participatingCharacters.push(value.participatingCharacters[0]); }, /正文参与角色.*重复/],
    ['invalid source', 'table', (value) => { value.participatingCharacters[1].evidence.sourceId = 'source-999'; }, /sourceId.*不存在/],
    ['user plan source', 'table', (value, input) => { value.participatingCharacters[1].evidence.sourceId = sourcePassages(input)[0].id; }, /messageId.*不属于本轮/],
    ['existing identity in newCharacters', 'table', (value) => { value.newCharacters[0].name = 'Elian'; }, /新角色名称.*重复/],
    ['duplicate new character', 'table', (value) => { value.newCharacters.push(value.newCharacters[0]); }, /新角色名称.*重复/],
    ['new character from a plan', 'table', (value, input) => { value.newCharacters[0].evidence.sourceId = sourcePassages(input)[0].id; }, /messageId.*不属于本轮/],
    ['wrong memory owner', 'memory', (value, input) => { if (input.character.id === 'arrival') value.characterId = 'host'; }, /新记忆的角色归属错误/],
    ['wrong state owner', 'memory', (value, input) => { if (input.character.id === 'arrival') value.stateChanges[0].target = { id: 'host-private-state' }; }, /target.id.*不是当前状态/],
    ['invalid memory source', 'memory', (value, input) => { if (input.character.id === 'arrival') value.stateChanges[0].evidence.sourceId = 'source-999'; }, /sourceId.*不存在/],
    ['new character memory failure', 'memory', (value, input) => { if (input.character.name === 'Mira') throw new Error('new-memory-failed'); }, /new-memory-failed/],
  ];
  for (const [name, stage, corrupt, expected] of cases) await t.test(name, async () => {
    const fixture = ensemble();
    fixture.state.memories.host[0].stateChanges = [{ id: 'host-private-state', op: 'set', subject: '书签', key: '位置', value: '口袋', previousFactId: null }];
    fixture.state = await store.saveSession(fixture.state);
    const before = structuredClone(fixture.state);
    let commitCalled = false;
    await assert.rejects(async () => store.saveSession(await runTurn({ ...fixture,
      beforeCommit: async () => { commitCalled = true; return {}; },
      callModel: async request => {
        const response = await fixture.callModel(request);
        if (request.stage === stage) corrupt(response, JSON.parse(request.messages.at(-1).content));
        return response;
      },
    })), expected);
    assert.equal(commitCalled, false);
    assert.deepEqual(fixture.state, before);
    assert.deepEqual(await store.session(fixture.state.id), before);
    if (stage === 'table') assert.deepEqual(fixture.calls.filter(call => call.stage === 'memory').map(call => call.input.character.id), ['host', 'planned']);
  });
});
