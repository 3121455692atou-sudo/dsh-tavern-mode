import { sourcePassages } from './helpers/tool-context.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryCandidates, currentFacts, validateStateChanges, effectiveMessages, evidenceSources, resolveEvidence, resolveStateChanges } from '../src/memory.js';
import { runTurn, buildRoster } from '../src/pipeline.js';
import { assembleWritingPrompt } from '../src/prompts.js';
import { Store } from '../src/storage.js';
import { defaultConfig, SEARCH_QUERY, RECALL, COMBINATION, PLAN, MEMORY, TABLE_UPDATE } from '../src/contracts.js';
import { makeModelCaller } from '../src/model.js';

const scene = { location: '排练室', time: '第501天傍晚', summary: '归还钥匙。' };
const change = (id, value, previousFactId = null) => ({ id, subject: '银钥匙', key: '位置', op: 'set', value, previousFactId, evidence: { messageId: 'old-message', quote: value } });
const archive = actor => Array.from({ length: 500 }, (_, index) => ({
  id: `${actor}-${index}`, summary: index ? `第${index + 1}天，${actor}完成例行排练。` : `${actor}把银钥匙放进老码头的铁柜。`, facts: [], relationships: [], openThreads: [],
  createdAt: new Date(Date.UTC(2025, 0, index + 1)).toISOString(), sourceMessageIds: [`message-${index}`],
  stateChanges: index === 0 ? [change(`${actor}-fact-0`, '老码头铁柜')] : [],
}));

test('Chinese and English full-text candidates stay bounded while retaining old matches and recent episodes', () => {
  const memories = archive('林岚');
  memories[1].summary = "O'Neil left a red guitar by the stage.";
  const result = memoryCandidates(memories, ['银钥匙 老码头', "O'Neil guitar"], 48);
  assert.equal(result.length, 48);
  assert.ok(result.some(memory => memory.id === '林岚-0'));
  assert.ok(result.some(memory => memory.id === '林岚-1'));
  assert.ok(result.some(memory => memory.id === '林岚-499'));
  assert.equal(new Set(result.map(memory => memory.id)).size, result.length);
  assert.equal(memoryCandidates(memories, ['" OR * NOT ('], 1).length, 1);
  const facts = Array.from({ length: 700 }, (_, index) => ({ ...change(`state-${index}`, `物品${index}已入库`), subject: `物品${index}` }));
  facts[0].value = '银钥匙仍在老码头铁柜';
  const stateCandidates = memoryCandidates(facts, ['银钥匙 老码头'], 48);
  assert.equal(stateCandidates.length, 48); assert.ok(stateCandidates.some(fact => fact.id === 'state-0'));
});

test('State changes require current baselines and exact source evidence, and replay retains historical versions', () => {
  const episodes = [{ stateChanges: [change('first', '老码头铁柜')] }];
  const source = [{ id: 'now', content: '周川将银钥匙放进背包。' }];
  const update = { ...change('second', '周川背包', 'first'), evidence: { messageId: 'now', quote: '将银钥匙放进背包' } };
  validateStateChanges([update], currentFacts(episodes), source);
  for (const invalid of [ { ...update, previousFactId: null }, { ...update, evidence: { messageId: 'future', quote: '将银钥匙放进背包' } }, { ...update, evidence: { messageId: 'now', quote: '钥匙已经交给林岚' } } ]) assert.throws(() => validateStateChanges([invalid], currentFacts(episodes), source));
  assert.throws(() => validateStateChanges([update, update], currentFacts(episodes), source), /一次/);
  assert.throws(() => validateStateChanges([
    { ...update, evidence: { messageId: 'now', quote: '错误原文甲' } },
    { ...update, subject: '另一物品', previousFactId: null, evidence: { messageId: 'now', quote: '错误原文乙' } },
  ], currentFacts(episodes), source), error => error.message.includes('错误原文甲') && error.message.includes('错误原文乙'));
  episodes.push({ stateChanges: [update] });
  assert.equal(currentFacts(episodes)[0].value, '周川背包');
  assert.equal(currentFacts(episodes.slice(0, 1))[0].value, '老码头铁柜');
  const removed = { ...update, op: 'remove', value: null, previousFactId: 'second' };
  validateStateChanges([removed], currentFacts(episodes), source);
  assert.deepEqual(currentFacts([...episodes, { stateChanges: [removed] }]), []);
});

test('Evidence references preserve original punctuation, line content and message ownership without model copying', () => {
  const messages = [{ id: 'first', content: '她说：“已经读完了。”\r\n\r\n手里还拿着书。' }, { id: 'second', content: '她说：“已经读完了。”' }];
  const sources = evidenceSources(messages);
  assert.equal(sources.length, 3);
  assert.deepEqual(resolveEvidence({ sourceId: sources[0].id }, sources), { messageId: 'first', quote: '她说：“已经读完了。”' });
  assert.deepEqual(resolveEvidence({ sourceId: sources[2].id }, sources), { messageId: 'second', quote: '她说：“已经读完了。”' });
  assert.throws(() => resolveEvidence({ sourceId: 'invented' }, sources), /sourceId.*不存在/);
});

test('Existing state targets preserve canonical property names by ID and reject stale references', () => {
  const sources = evidenceSources([{ id: 'message', content: '钥匙已经放进内袋。' }]);
  const current = [{ id: 'current', subject: '银钥匙', key: '保管位置', value: '桌面' }];
  const update = { op: 'set', target: { id: 'current' }, value: '内袋', evidence: { sourceId: 'source-1' } };
  assert.deepEqual(resolveStateChanges([update], current, sources), [{ op: 'set', subject: '银钥匙', key: '保管位置', value: '内袋', previousFactId: 'current', evidence: { messageId: 'message', quote: '钥匙已经放进内袋。' } }]);
  assert.throws(() => resolveStateChanges([{ ...update, target: { id: 'outdated' } }], current, sources), /不是当前状态/);
  const created = resolveStateChanges([{ ...update, target: { subject: '银钥匙', key: '颜色' }, value: '银色' }], current, sources);
  assert.equal(created[0].previousFactId, null); assert.equal(created[0].key, '颜色');
});

test('A 500-episode turn bounds each agent input, distinguishes outdated knowledge from current world state, and restores its revision', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tavern-memory-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(directory); await store.init();
  const state = { id: 'long-history', config: defaultConfig({ provider: 'fixture', model: 'fixture' }), userName: '访客', messages: Array.from({ length: 1000 }, (_, index) => ({ id: `message-${index}`, role: index % 2 ? 'assistant' : 'user', content: '完成当天排练。' })), scene, renderMode: 'text', tables: {}, variables: {}, characters: [{ id: 'a', name: '林岚', profile: '成年乐手。' }, { id: 'b', name: '周川', profile: '成年乐手。' }], memories: { a: archive('林岚'), b: archive('周川') }, worldHistory: archive('世界') };
  state.memories.b.at(-1).stateChanges = [change('b-last', '周川背包', '周川-fact-0')];
  state.worldHistory.at(-1).stateChanges = [change('world-last', '周川背包', '世界-fact-0')];
  const saved = await store.saveSession(state);
  const counts = { query: 0, recall: 0, memory: 0 };
  const story = '周川把银钥匙交到林岚手里。林岚收进内袋。';
  const callModel = async ({ stage, schema, messages }) => {
    const input = schema ? JSON.parse(messages.at(-1).content) : {};
    if (schema === SEARCH_QUERY) {
      counts.query++; assert.ok(input.recentMemories.length <= 8); assert.equal(input.messages, undefined);
      return { queries: ['银钥匙 老码头 铁柜 归还'] };
    }
    if (stage === 'recall') {
      counts.recall++; assert.equal(input.memories.length, 48); assert.equal(input.messages, undefined);
      assert.equal(input.currentState[0].value, input.character.id === 'a' ? '老码头铁柜' : '周川背包');
      assert.ok(input.memories.some(memory => memory.id === `${input.character.name}-0`));
      assert.ok(input.memories.every(memory => memory.id.startsWith(input.character.name)));
      return { characterId: input.character.id, memories: input.memories.map(memory => ({ id: memory.id, relevance: 1 })), perspective: '回想钥匙的下落。', likelyPresent: true };
    }
    if (schema === COMBINATION) {
      assert.equal(input.recalls.characters.length, 2); assert.ok(input.recalls.characters.every(recall => recall.records.length === 8 && recall.memories === undefined));
      assert.equal(input.worldState[0].value, '周川背包'); assert.ok(input.worldEpisodes.length <= 8);
      return { scene, presentCharacterIds: ['a', 'b'], worldEntryIds: [], situation: '归还钥匙', characterViews: [], openThreads: [] };
    }
    if (schema === PLAN) return { scene, beats: ['归还钥匙'], characterIntents: [], constraints: [] };
    if (schema?.properties.events) {
      counts.memory++;
      const sourceId = sourcePassages(input).at(-1).id;
      return { events: [{ summary: '银钥匙交给林岚。', knownByCharacterIds: ['a', 'b'], evidence: { sourceId } }], characters: input.characterStates.map(c => ({ characterId: c.characterId, stateChanges: [{ op: 'set', target: { id: c.currentState[0].id }, value: '林岚内袋', evidence: { sourceId } }] })) };
    }
    if (schema === MEMORY || schema === TABLE_UPDATE) {
      const current = schema === MEMORY ? input.currentState : input.currentWorldState;
      const update = { op: 'set', target: { id: current[0].id }, value: '林岚内袋', evidence: { sourceId: sourcePassages(input).at(-1).id } };
      if (schema === MEMORY) {
        counts.memory++; assert.ok(input.previousMemories.length <= 16);
        return { characterId: input.character.id, summary: '亲眼看见银钥匙交到林岚手里并收进内袋。', facts: [], relationships: [], openThreads: [], stateChanges: [update] };
      }
      return { scene, operations: [], worldChanges: [update], participatingCharacters: [], newCharacters: [] };
    }
    assert.ok(messages.some(message => message.content.includes('老码头铁柜') && message.content.includes('周川背包')));
    return story;
  };
  const result = await runTurn({ state: saved, card: { name: '排练室', description: '两位成年乐手。' }, text: '那把银色的钥匙找到了吗？', callModel });
  assert.deepEqual(counts, { query: 2, recall: 2, memory: 1 });
  assert.equal(currentFacts(result.memories.a)[0].value, '林岚内袋');
  assert.equal(currentFacts(result.memories.b)[0].value, '林岚内袋');
  assert.equal(currentFacts(result.worldHistory)[0].value, '林岚内袋');
  assert.deepEqual(currentFacts(result.worldHistory)[0].evidence, { messageId: result.messages.at(-1).id, quote: story });
  assert.equal(currentFacts(saved.memories.a)[0].value, '老码头铁柜');
  const next = await store.saveSession(result);
  assert.equal(currentFacts((await store.session(next.id)).worldHistory)[0].value, '林岚内袋');
  const restored = await store.restore(saved.id, saved.revision);
  assert.equal(currentFacts(restored.memories.a)[0].value, '老码头铁柜');
  assert.equal(currentFacts(restored.worldHistory)[0].value, '周川背包');
});

test('The model adapter repairs evidence failures using the same contract and supplied evidence', async () => {
  let attempts = 0;
  const source = [{ id: 'message', content: '钥匙放在桌上。' }];
  const call = makeModelCaller({ async *stream() {
    attempts++;
    const value = { characterId: 'a', summary: '', facts: [], relationships: [], openThreads: [], stateChanges: [{ op: 'set', target: { subject: '钥匙', key: '位置' }, value: '桌上', evidence: { sourceId: attempts === 1 ? 'invented' : 'source-1' } }] };
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', name: 'tavern_result', arguments: JSON.stringify(value) } };
    yield { type: 'finish', reason: { kind: 'tool-calls' } };
  } });
  await call({ agent: { provider: 'fixture', model: 'fixture' }, messages: [], schema: MEMORY, repairContext: { sourcePassages: evidenceSources(source) }, validate: value => validateStateChanges(resolveStateChanges(value.stateChanges, [], evidenceSources(source)), [], source) });
  assert.equal(attempts, 2);
});

test('Helper edits feed the next prompt and macros without replacing canonical native messages', async () => {
  const state = { id: 'edited', config: defaultConfig(), messages: [{ id: 'm', role: 'assistant', content: '旧地点' }], helperChat: [{ tavernMessageId: 'm', mes: '新地点' }], tables: {}, renderMode: 'text' };
  assert.equal(effectiveMessages(state)[0].content, '新地点');
  const prompt = await assembleWritingPrompt({ state, card: { name: '角色' }, worldbook: [] });
  assert.ok(prompt.messages.some(message => message.content === '新地点'));
  assert.ok(!prompt.messages.some(message => message.content === '旧地点'));
  assert.equal(state.messages[0].content, '旧地点');
});

test('A newly encountered named character gets its own first-turn memory and participates in the following recall', async () => {
  const state = { id: 'new-cast', userName: '访客', config: defaultConfig({ provider: 'fixture', model: 'fixture' }), messages: [], scene, tables: {}, variables: {}, renderMode: 'text', characters: [{ id: 'a', name: '林岚', profile: '成年乐手。' }], memories: { a: [] } };
  const recallNames = [];
  const story = '成年维修师顾青到达排练室。林岚说明音箱的故障。顾青答应明早来检修音箱。';
  const callModel = async ({ stage, schema, messages }) => {
    const input = schema ? JSON.parse(messages.at(-1).content) : {};
    if (stage === 'recall') { recallNames.push(input.character.name); return { characterId: input.character.id, memories: [], perspective: '', likelyPresent: true }; }
    if (schema === COMBINATION) return { scene, presentCharacterIds: input.characters.map(character => character.id), worldEntryIds: [], situation: '商量检修', characterViews: [], openThreads: [] };
    if (schema === PLAN) return { scene, beats: [], characterIntents: [], constraints: [] };
    if (schema === TABLE_UPDATE) return { scene, operations: [], worldChanges: [], participatingCharacters: [], newCharacters: input.characters.some(character => character.name === '顾青') ? [] : [{ name: '顾青', profile: '成年音箱维修师。', evidence: { sourceId: sourcePassages(input).at(-1).id } }] };
    if (schema === MEMORY) {
      return { characterId: input.character.id, summary: '商定明早检修音箱。', facts: [], relationships: [], openThreads: [], stateChanges: input.currentState.length ? [] : [{ op: 'set', target: { subject: '顾青', key: '承诺' }, value: '明早检修音箱', evidence: { sourceId: sourcePassages(input).at(-1).id } }] };
    }
    return story;
  };
  const first = await runTurn({ state, card: { name: '排练室' }, text: '商量音箱检修。', callModel });
  const added = first.characters.find(character => character.name === '顾青');
  assert.ok(added?.id); assert.equal(first.memories[added.id].length, 1);
  assert.equal(currentFacts(first.memories[added.id])[0].value, '明早检修音箱');
  const second = await runTurn({ state: first, card: { name: '排练室' }, text: '确认约定。', callModel });
  assert.deepEqual(recallNames, ['林岚', '顾青']);
  assert.equal(second.characters.length, 2); assert.equal(state.characters.length, 1);
});

test('Initial casting follows active worldbook entries, including the new input, and permits a solitary opening', async () => {
  const state = { id: 'solitary', userName: '访客', config: defaultConfig({ provider: 'fixture', model: 'fixture' }), messages: [], scene, tables: {}, variables: {}, renderMode: 'text', characters: [], memories: {} };
  const card = { name: '城市漫步', description: '由玩家探索城市。', character_book: { entries: [
    { id: 1, keys: ['图书馆'], content: '顾青是图书馆值班员。', enabled: true },
    { id: 2, constant: true, content: '已禁用的角色资料', enabled: false },
    { id: 3, keys: ['剧院'], content: '另一场景的角色资料', enabled: true },
  ] } };
  await buildRoster({ state, card, text: '走到图书馆。', callModel: async ({ messages }) => {
    const input = JSON.parse(messages.at(-1).content);
    assert.deepEqual([...input.staticWorldbook, ...input.worldbook].map(entry => entry.content), ['顾青是图书馆值班员。']);
    return { characters: [] };
  } });
  const stages = [];
  const result = await runTurn({ state, card, text: '独自沿街散步。', callModel: async ({ stage, schema }) => {
    stages.push(stage);
    if (schema === COMBINATION) return { scene, presentCharacterIds: [], worldEntryIds: [], situation: '独自散步', characterViews: [], openThreads: [] };
    if (schema === PLAN) return { scene, beats: [], characterIntents: [], constraints: [] };
    if (schema === TABLE_UPDATE) return { scene, operations: [], worldChanges: [], participatingCharacters: [], newCharacters: [] };
    return '街道很安静。';
  } });
  assert.deepEqual(stages, ['combine', 'advance', 'write', 'table']);
  assert.equal(result.messages.at(-1).content, '街道很安静。');
});

test('Independent character search and recall agents overlap before combination and keep separate archives', async () => {
 const config=defaultConfig();config.concurrency=2;
 const state={id:'parallel',userName:'访客',config,messages:[],tables:{},variables:{},scene,characters:[{id:'a',name:'甲'},{id:'b',name:'乙'}],memories:{a:archive('a'),b:archive('b')}};
 let release;const ready=new Promise(resolve=>release=resolve),searches=new Set(),recalled=new Set();
 const timer=setTimeout(()=>release(),1000);
 try {
  await assert.rejects(runTurn({state,card:{name:'排练室'},text:'回忆银钥匙在哪里。',callModel:async({stage,schema,messages})=>{
   const input=JSON.parse(messages.at(-1).content);
   if(schema===SEARCH_QUERY){searches.add(input.character.id);if(searches.size===2)release();await ready;assert.equal(searches.size,2,'searches must overlap');return{queries:['银钥匙 老码头']};}
   if(stage==='recall'){const id=input.character.id;assert.ok(input.memories.every(record=>record.id.startsWith(id+'-')));recalled.add(id);return{characterId:id,memories:[{id:input.memories[0].id,relevance:1}],perspective:'回忆自己的经历。',likelyPresent:true};}
   assert.equal(schema,COMBINATION);assert.equal(recalled.size,2);assert.ok(input.recalls.characters.every(recall=>recall.records.every(record=>record.summary.includes(recall.characterId))));throw Error('parallel-probe-complete');
  }}),/parallel-probe-complete/);
 }finally{clearTimeout(timer);}
});
