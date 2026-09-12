import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoster, runTurn } from '../src/pipeline.js';
import { PLAN, SEARCH_QUERY, defaultConfig } from '../src/contracts.js';
import { assembleWritingPrompt, prepareWorldbook } from '../src/prompts.js';
import { activateWorldbookWithEvents } from '../src/worldbook.js';

const MARKER = {
  disabledKeyHit: 'ZZQKEYHIT7412',
  disabledIdLinked: 'ZZQIDLINK7419',
  enabledEntry: 'ZZQLIVEENTRY7426',
  enabledKeyHit: 'ZZQLIVEKEY7433',
};
const disabledMarkers = [MARKER.disabledKeyHit, MARKER.disabledIdLinked];
const enabledMarkers = [MARKER.enabledEntry, MARKER.enabledKeyHit];
const scene = { location: '中性房间', time: '白天', summary: '中性场景描述。' };
const card = {
  name: '中性卡', description: '中性说明。', first_mes: '中性开场。', extensions: {},
  character_book: { entries: [
    { id: 1, keys: ['林岚'], content: `中性资料甲 ${MARKER.disabledKeyHit}`, enabled: false },
    { id: 2, keys: ['与角色名无关的键'], content: `中性资料乙 ${MARKER.disabledIdLinked}`, enabled: false },
    { id: 3, keys: ['与角色名无关的键'], content: `中性资料丙 ${MARKER.enabledEntry}`, enabled: true, constant: true },
    { id: 4, keys: ['林岚'], content: `中性资料丁 ${MARKER.enabledKeyHit}` },
  ] },
};
const legacy = { plotTasks: [{ id: 'neutral-task', name: '中性推进子任务', extractTags: 'plan', promptGroup: [{ role: 'USER', content: '$1' }] }] };

function buildState() {
  return {
    id: 'disabled-worldbook-session', revision: 'before', cardId: 'card', userName: '访客', persona: '',
    scene: { location: '', time: '', summary: '' }, config: defaultConfig({ provider: 'fixture', model: 'fixture' }),
    tables: {}, messages: [], variables: {}, renderMode: 'text',
    characters: [{ id: 'actor-a', name: '林岚', profile: '中性档案。', enabled: true, worldbookIds: ['card:2', 'card:3'] }],
    memories: { 'actor-a': [{ id: 'mem-a1', summary: '中性记忆。', facts: [], relationships: [], openThreads: [] }] },
  };
}

function captureModel(requests, worldEntryIds = ['card:3', 'card:4']) {
  return async ({ stage, label, messages, schema }) => {
    requests.push({ stage, label, search: schema === SEARCH_QUERY, messages: structuredClone(messages) });
    if (stage === 'roster') return { characters: [{ name: '林岚', profile: '中性档案。', worldbookIds: worldEntryIds }] };
    if (stage === 'recall' && schema === SEARCH_QUERY) return { queries: ['中性查询'] };
    if (stage === 'recall') return { characterId: 'actor-a', memories: [], perspective: '中性视角。', likelyPresent: true };
    if (stage === 'combine') return { scene, presentCharacterIds: ['actor-a'], worldEntryIds, situation: '中性情形。', characterViews: [{ characterId: 'actor-a', knowledge: '中性认知。', intent: '中性意图。' }], openThreads: [] };
    if (stage === 'advance' && schema !== PLAN) return { sections: { plan: '中性子任务结果。' } };
    if (stage === 'advance') return { scene, beats: ['中性节拍。'], characterIntents: [], constraints: [] };
    if (stage === 'table') return { operations: [], scene, worldChanges: [], participatingCharacters: [], newCharacters: [] };
    if (stage === 'memory') return { characterId: 'actor-a', summary: '中性更新。', facts: [], relationships: [], openThreads: [], stateChanges: [] };
    if (stage === 'write') return '中性正文。';
    throw new Error(`未预期的模型阶段：${stage}`);
  };
}

function hits(requests, markers) {
  return requests.flatMap(({ stage, label, search, messages }) => markers
    .filter(marker => JSON.stringify(messages).includes(marker))
    .map(marker => ({ stage, label, search, marker })));
}

for (const options of [
  { name: 'disabled key hits and linked ids stay out of every model stage' },
  { name: 'recall search queries also exclude disabled profiles', search: true },
  { name: 'external books honor disable:true and implicit enabled entries', external: true, search: true },
  { name: 'disabled entries sharing an enabled id stay out of advance requests', duplicateId: true },
]) {
  test(`runTurn: ${options.name}`, async t => {
    const state = buildState(), fixtureCard = structuredClone(card), extraBooks = [];
    const prefix = options.external ? 'neutral-book' : 'card';
    if (options.external) {
      for (const entry of fixtureCard.character_book.entries.slice(0, 2)) { delete entry.enabled; entry.disable = true; }
      extraBooks.push({ id: prefix, name: '中性外部资料', data: fixtureCard.character_book });
      fixtureCard.character_book = { entries: [] };
    }
    if (options.duplicateId) fixtureCard.character_book.entries[1].id = 3;
    state.characters[0].worldbookIds = [`${prefix}:2`, `${prefix}:3`];
    if (options.search) {
      state.config.recallBatchSize = 1;
      state.memories['actor-a'].push({ ...state.memories['actor-a'][0], id: 'mem-a2' });
    }
    const original = structuredClone({ state, fixtureCard, extraBooks });
    const worldEntryIds = [`${prefix}:3`, `${prefix}:4`], requests = [];
    const result = await runTurn({ state, card: fixtureCard, extraBooks, legacy, callModel: captureModel(requests, worldEntryIds), text: '林岚，中性输入。' });

    assert.equal(requests.length, options.search ? 8 : 7);
    assert.deepEqual(new Set(requests.map(request => request.stage)), new Set(['recall', 'combine', 'advance', 'write', 'memory', 'table']));
    assert.equal(requests.filter(request => request.search).length, options.search ? 1 : 0);
    for (const request of requests.filter(request => ['recall', 'combine', 'advance', 'write'].includes(request.stage))) {
      for (const marker of enabledMarkers) assert.ok(JSON.stringify(request.messages).includes(marker), `${request.stage}/${request.label} 应保留启用资料 ${marker}`);
    }
    const combinationInput = JSON.parse(requests.find(request => request.stage === 'combine').messages.at(-1).content);
    assert.deepEqual(combinationInput.worldbookDirectory.map(entry => entry.id), worldEntryIds);
    assert.deepEqual({ state, fixtureCard, extraBooks }, original, '完整输入资料不能被过滤或修改');
    assert.equal(result.messages.at(-1).content, '中性正文。');
    const leaked = hits(requests, disabledMarkers);
    t.diagnostic(JSON.stringify({ capturedRequests: requests.map(({ stage, label, search }) => ({ stage, label, search })), disabledHits: leaked }));
    assert.deepEqual(leaked, [], '停用条目不能直接进入任何模型请求');
  });
}

test('buildRoster exposes only enabled worldbook content and ids', async () => {
  const requests = [];
  await buildRoster({ state: buildState(), card, text: '林岚，中性输入。', callModel: captureModel(requests) });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].stage, 'roster');
  const input = JSON.parse(requests[0].messages.at(-1).content);
  assert.deepEqual(input.worldbook.map(entry => entry.id), ['card:3', 'card:4']);
  assert.equal(hits(requests, enabledMarkers).length, 2);
  assert.deepEqual(hits(requests, disabledMarkers), []);
});

test('combination cannot force a disabled worldbook id into later model stages', async () => {
  const requests = [];
  await assert.rejects(runTurn({ state: buildState(), card, text: '林岚，中性输入。', callModel: captureModel(requests, ['card:2']) }), /世界书召回.*card:2/);
  assert.deepEqual(requests.map(request => request.stage), ['recall', 'combine']);
});

test('complete disabled entries remain available to real template scripts and scan listeners', async () => {
  const state = buildState(), original = structuredClone(card);
  const worldbook = await prepareWorldbook(state, card);
  assert.deepEqual(worldbook.map(entry => entry.id), ['card:1', 'card:2', 'card:3', 'card:4']);
  assert.deepEqual(worldbook.map(entry => entry.enabled), [false, false, true, true]);
  assert.deepEqual(worldbook.map(entry => entry.content), card.character_book.entries.map(entry => entry.content));
  let loaded = false;
  const result = await assembleWritingPrompt({ state,
    card: { ...card, system_prompt: '<% setvar("disabledWorldbookContent", await getwi(getchar().name, 1)) %>中性系统消息。' },
    worldbook, forcedWorldIds: worldbook.map(entry => entry.id),
    scanWorldbook: ({ entries, options }) => activateWorldbookWithEvents(entries, options, async (name, data) => {
      if (name !== 'worldinfo_entries_loaded') return;
      loaded = true;
      assert.equal(data.characterLore.length, 4);
      assert.equal(data.characterLore[0].disable, true);
      assert.equal(data.characterLore[1].disable, true);
      assert.equal(data.characterLore[0].content, card.character_book.entries[0].content);
      assert.equal(data.characterLore[1].content, card.character_book.entries[1].content);
    }),
  });
  assert.ok(loaded);
  assert.equal(result.variables.disabledWorldbookContent, card.character_book.entries[0].content);
  assert.deepEqual(result.worldEntryIds, ['card:3', 'card:4']);
  assert.deepEqual(hits([{ stage: 'write', messages: result.messages }], disabledMarkers), []);
  assert.deepEqual(card, original);
});
