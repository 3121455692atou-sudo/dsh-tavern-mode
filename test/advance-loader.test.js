import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage.js';
import { importBytes } from '../src/imports.js';
import { sessionAssets } from '../src/session-assets.js';
import { runTurn, mapConcurrent } from '../src/pipeline.js';
import { runAdvancePreset } from '../src/advance.js';
import { prepareAdvanceWorldbooks, prepareWorldbook } from '../src/prompts.js';
import { PLAN, defaultConfig } from '../src/contracts.js';

const captures = [];
const scene = { location: '资料室', time: '白天', summary: '整理资料。' };
const task = (name, options = {}) => ({ id: name, name, extractTags: 'result',
  promptGroup: [{ role: 'USER', content: '<books>$1</books>' }], ...options });
const manual = (names, enabledEntries) => ({ plotWorldbookConfig: { source: 'manual', manualSelection: names, ...(enabledEntries ? { enabledEntries } : {}) } });
const entry = (uid, content, options = {}) => ({ uid, content, constant: true, key: ['甲', '乙'], ...options });

async function fixture(t, profile = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-advance-loader-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new Store(root); await store.init();
  const add = async (filename, data) => (await importBytes(store, filename, Buffer.from(JSON.stringify(data))))[0];
  const card = await add('Ensemble.json', { spec: 'chara_card_v2', data: {
    name: 'Ensemble', description: '中性场景。', extensions: {}, first_mes: '整理资料。',
    character_book: { name: 'Bound Canon', entries: [entry(0, 'BOUND_ONLY')] },
  } });
  const publicBook = await add('Public Handbook.json', { entries: [entry(0, 'PUBLIC_ONLY')] });
  const atlas = await add('Maproom.json', { name: 'Not the imported resource name', entries: [
    entry(0, '<if db="true">MANUAL_ZERO {{user}}/{{char}}/{{getvar::signal}}/<%= getvar("signal") %><else>WRONG_CONDITION</if>'),
    entry(1, 'MANUAL_ONE'), entry(2, 'MANUAL_DISABLED', { disable: true }),
  ] });
  const ledger = await add('Ledger.json', { entries: [entry(0, 'LEDGER_ZERO'), entry(1, 'LEDGER_ONE')] });
  const empty = await add('Empty Book.json', { entries: [] });
  await add('Unselected Archive.json', { entries: [entry(0, 'UNSELECTED_LIBRARY')] });
  const legacy = await add('Advance.json', { ...manual(['Maproom'], { Maproom: [0] }),
    plotTasks: [task('manual-task'), task('character-task', { plotWorldbookConfig: { source: 'character' } })],
    ...(typeof profile === 'function' ? profile({ card, atlas, ledger, empty, publicBook }) : profile) });
  const actors = ['甲', '乙'].map((name, index) => ({ id: `actor-${index}`, name, profile: '资料整理员。', enabled: true,
    worldbookIds: ['card:0', `${publicBook.id}:0`, `${atlas.id}:0`] }));
  const state = { id: 'loader-session', revision: 'before', cardId: card.id, legacyId: legacy.id,
    worldbookIds: [publicBook.id], userName: '访客', persona: '', renderMode: 'text', scene,
    config: defaultConfig({ provider: 'fixture', model: 'fixture' }), tables: {}, messages: [],
    characters: actors, memories: Object.fromEntries(actors.map(actor => [actor.id, [{ id: `memory-${actor.id}`, summary: '之前整理了资料。', facts: [], relationships: [], openThreads: [] }]])),
    variables: { signal: 'TEMPLATE_VALUE' }, turn: 0 };
  return { store, add, state, card, atlas, ledger, empty, publicBook };
}

function model(requests, label) {
  return async ({ stage, messages, schema, label: taskLabel }) => {
    const request = { case: label, stage, label: taskLabel, messages: structuredClone(messages), schema };
    requests.push(request); captures.push(request);
    if (stage === 'advance' && schema !== PLAN) return { sections: { result: '中性推进结果。' } };
    if (stage === 'advance') return { scene, beats: ['整理资料。'], characterIntents: [], constraints: [] };
    if (stage === 'combine') return { scene, presentCharacterIds: ['actor-0', 'actor-1'], worldEntryIds: ['card:0'],
      situation: '开始整理资料。', characterViews: [], openThreads: [] };
    if (stage === 'recall') {
      const input = JSON.parse(messages.at(-1).content);
      return { characterId: input.character.id, memories: [], perspective: '资料整理员的视角。', likelyPresent: true };
    }
    if (stage === 'memory') {
      const input = JSON.parse(messages.at(-1).content);
      return { characterId: input.character.id, summary: '完成整理。', facts: [], relationships: [], openThreads: [], stateChanges: [] };
    }
    if (stage === 'table') return { scene, operations: [], worldChanges: [], participatingCharacters: [], newCharacters: [] };
    if (stage === 'write') return '大家完成了资料整理。';
    throw new Error(`Unexpected stage ${stage}`);
  };
}
const body = (requests, label) => requests.find(request => request.label === label)?.messages.find(message => message.content.startsWith('<books>')).content;
async function turn(t, args) {
  const before = structuredClone(args.state), assets = await sessionAssets(args.store, args.state), requests = [];
  const result = await runTurn({ state: args.state, ...assets, text: '甲和乙开始整理资料。', callModel: model(requests, t.name) });
  assert.deepEqual(args.state, before);
  return { assets, requests, result };
}

test('real loader brings an unselected manual resource only into its advance task', async t => {
  const args = await fixture(t);
  assert.ok(!args.state.worldbookIds.includes(args.atlas.id));
  const { assets, requests } = await turn(t, args);
  assert.deepEqual(assets.extraBooks.map(book => book.id), [args.publicBook.id]);
  assert.equal(body(requests, 'manual-task'), '<books>MANUAL_ZERO 访客/Ensemble/TEMPLATE_VALUE/TEMPLATE_VALUE</books>');
  assert.equal(body(requests, 'character-task'), '<books>BOUND_ONLY</books>');
  assert.equal(requests.filter(request => request.stage === 'recall').length, 2);
  for (const request of requests.filter(request => request.label !== 'manual-task')) {
    assert.doesNotMatch(JSON.stringify(request.messages), /MANUAL_|LEDGER_|UNSELECTED_LIBRARY/);
  }
  for (const stage of ['recall', 'combine', 'write']) {
    assert.match(JSON.stringify(requests.find(request => request.stage === stage).messages), /PUBLIC_ONLY/);
  }
});

test('session-selected manual resource already uses the existing conditional and macro path', async t => {
  const args = await fixture(t);
  args.state.worldbookIds.push(args.atlas.id);
  const { requests } = await turn(t, args);
  assert.equal(body(requests, 'manual-task'), '<books>MANUAL_ZERO 访客/Ensemble/TEMPLATE_VALUE/TEMPLATE_VALUE</books>');
});

test('real loader and template preparation preserve resource identities including empty books', async t => {
  const args = await fixture(t, manual(['Maproom', 'Empty Book']));
  const originalCard = await args.store.item(args.card.id), originalBook = await args.store.item(args.atlas.id);
  const assets = await sessionAssets(args.store, args.state);
  const before = structuredClone(assets);
  const directory = await prepareAdvanceWorldbooks(args.state, assets.card, assets.advanceWorldbooks);
  const atlas = directory.find(book => book.id === args.atlas.id);
  assert.equal(atlas.name, 'Maproom'); assert.equal(atlas.source, 'manual');
  assert.deepEqual(atlas.entries.map(entry => [entry.id, entry.world, entry.originalId, entry.enabled]), [
    [`${args.atlas.id}:0`, 'Maproom', 0, true], [`${args.atlas.id}:1`, 'Maproom', 1, true], [`${args.atlas.id}:2`, 'Maproom', 2, false],
  ]);
  assert.equal(atlas.entries[0].content, 'MANUAL_ZERO {{user}}/{{char}}/{{getvar::signal}}/<%= getvar("signal") %>');
  assert.deepEqual(directory.find(book => book.id === args.empty.id), { id: args.empty.id, name: 'Empty Book', source: 'manual', entries: [] });
  assert.equal(directory.find(book => book.source === 'character').id, args.card.id);
  assert.deepEqual(assets, before);
  assert.deepEqual(await args.store.item(args.card.id), originalCard);
  assert.deepEqual(await args.store.item(args.atlas.id), originalBook);
});

test('runAdvancePreset directly consumes the separately prepared directory', async t => {
  const args = await fixture(t), assets = await sessionAssets(args.store, args.state), requests = [];
  const state = structuredClone(args.state);
  const worldbook = await prepareWorldbook(state, assets.card, assets.extraBooks);
  const advanceWorldbooks = await prepareAdvanceWorldbooks(state, assets.card, assets.advanceWorldbooks);
  const before = structuredClone({ worldbook, advanceWorldbooks });
  await runAdvancePreset({ state, card: assets.card, data: assets.legacy, worldbook, advanceWorldbooks,
    text: '整理资料。', callModel: model(requests, t.name), emit() {}, trace: [], mapConcurrent });
  assert.equal(body(requests, 'manual-task'), '<books>MANUAL_ZERO 访客/Ensemble/TEMPLATE_VALUE/TEMPLATE_VALUE</books>');
  assert.equal(body(requests, 'character-task'), '<books>BOUND_ONLY</books>');
  assert.deepEqual({ worldbook, advanceWorldbooks }, before);
});

test('persistent resource ids resolve to real book names for UID selection', async t => {
  const args = await fixture(t, ({ atlas }) => manual([atlas.id], { Maproom: [1] }));
  const { requests } = await turn(t, args);
  assert.equal(body(requests, 'manual-task'), '<books>MANUAL_ONE</books>');
});

test('UID choices remain scoped to each resolved book and never enable disabled entries', async t => {
  const args = await fixture(t, manual(['Maproom', 'Ledger'], { Maproom: [1, 2], Ledger: [0] }));
  const { requests } = await turn(t, args);
  assert.equal(body(requests, 'manual-task'), '<books>MANUAL_ONE\n\nLEDGER_ZERO</books>');
});

test('task overrides load only their sources with nested and legacy selection precedence', async t => {
  const args = await fixture(t, { worldbookSource: 'manual', selectedWorldbooks: ['Missing legacy selection'],
    plotWorldbookConfig: { source: 'character' }, plotTasks: [
      task('character-task'), task('atlas-task', manual(['Maproom'], { Maproom: [1] })),
      task('ledger-task', { plotWorldbookConfig: null, worldbookSource: 'manual', selectedWorldbooks: ['Ledger'] }),
      task('empty-selection', manual([])),
      task('disabled-task', { enabled: false, ...manual(['Missing disabled source']) }),
      task('disabled-worldbook', { worldbookEnabled: false, ...manual(['Missing disabled source']) }),
    ] });
  const { assets, requests } = await turn(t, args);
  assert.deepEqual(assets.advanceWorldbooks.map(book => book.name).sort(), ['Bound Canon', 'Ledger', 'Maproom']);
  assert.equal(body(requests, 'character-task'), '<books>BOUND_ONLY</books>');
  assert.equal(body(requests, 'atlas-task'), '<books>MANUAL_ONE</books>');
  assert.equal(body(requests, 'ledger-task'), '<books>LEDGER_ZERO\n\nLEDGER_ONE</books>');
  assert.equal(body(requests, 'empty-selection'), '<books></books>');
  assert.equal(body(requests, 'disabled-worldbook'), '<books></books>');
  assert.equal(body(requests, 'disabled-task'), undefined);
});

test('task enable overrides profile worldbook disable at the loader boundary', async t => {
  const args = await fixture(t, { worldbookEnabled: false, plotTasks: [task('manual-task', { worldbookEnabled: true })] });
  const { requests } = await turn(t, args);
  assert.match(body(requests, 'manual-task'), /MANUAL_ZERO/);
});

test('session overrides apply to manual and character sources without editing imported resources', async t => {
  const args = await fixture(t), before = await args.store.item(args.atlas.id);
  args.state.worldbookOverrides = {
    [args.atlas.id]: [entry(0, 'OVERRIDE_MANUAL {{user}}'), entry(1, 'OVERRIDE_NOT_SELECTED')],
    [args.card.id]: [entry(0, 'OVERRIDE_BOUND {{char}}')],
  };
  const { requests } = await turn(t, args);
  assert.equal(body(requests, 'manual-task'), '<books>OVERRIDE_MANUAL 访客</books>');
  assert.equal(body(requests, 'character-task'), '<books>OVERRIDE_BOUND Ensemble</books>');
  assert.deepEqual(await args.store.item(args.atlas.id), before);
  for (const request of requests.filter(request => request.label !== 'manual-task')) assert.doesNotMatch(JSON.stringify(request.messages), /OVERRIDE_MANUAL/);
});

for (const emptyBy of ['import', 'override', 'selection']) test(`resolved empty worldbook remains legal: ${emptyBy}`, async t => {
  const args = await fixture(t, manual([emptyBy === 'import' ? 'Empty Book' : 'Maproom'], emptyBy === 'selection' ? { Maproom: [] } : undefined));
  if (emptyBy === 'override') args.state.worldbookOverrides = { [args.atlas.id]: [] };
  const { assets, requests } = await turn(t, args);
  assert.ok(assets.advanceWorldbooks.some(book => book.id === (emptyBy === 'import' ? args.empty.id : args.atlas.id)));
  assert.equal(body(requests, 'manual-task'), '<books></books>');
});

for (const selection of ['Missing Book', 'Not the imported resource name']) test(`missing source reports a resolvable error before any request: ${selection}`, async t => {
  const args = await fixture(t, manual([selection]));
  let calls = 0;
  await assert.rejects(async () => runTurn({ state: args.state, ...await sessionAssets(args.store, args.state),
    text: '整理资料。', callModel: async () => { calls++; throw new Error('Model must not be called'); } }),
  error => error.message.includes(selection) && /世界书/.test(error.message) && /导入/.test(error.message));
  assert.equal(calls, 0);
});

test('ambiguous imported names report candidate ids; a persistent id selects exactly one source', async t => {
  const args = await fixture(t);
  const duplicate = await args.add('Maproom.json', { entries: [entry(0, 'OTHER_MAPROOM')] });
  await assert.rejects(sessionAssets(args.store, args.state), error =>
    /同名/.test(error.message) && error.message.includes('Maproom') && error.message.includes(args.atlas.id) && error.message.includes(duplicate.id));
  const item = await args.store.item(args.state.legacyId);
  await args.store.putItem({ ...item, data: { ...item.data, ...manual([args.atlas.id], { Maproom: [1] }) } });
  const { requests } = await turn(t, args);
  assert.equal(body(requests, 'manual-task'), '<books>MANUAL_ONE</books>');
  assert.doesNotMatch(JSON.stringify(requests), /OTHER_MAPROOM/);
});

test('same resolved source selected by id and name is injected once', async t => {
  const args = await fixture(t, ({ atlas }) => manual(['Maproom', atlas.id], { Maproom: [1] }));
  const { requests } = await turn(t, args);
  assert.equal(body(requests, 'manual-task'), '<books>MANUAL_ONE</books>');
});

test('plotSettings wrapper and legacy selectedWorldbooks resolve through the same loader', async t => {
  const args = await fixture(t, { plotSettings: { worldbookSource: 'manual', selectedWorldbooks: ['Ledger'], plotTasks: [task('ledger-task')] } });
  const { requests, assets } = await turn(t, args);
  assert.deepEqual(assets.advanceWorldbooks.map(book => book.name), ['Ledger']);
  assert.equal(body(requests, 'ledger-task'), '<books>LEDGER_ZERO\n\nLEDGER_ONE</books>');
});

for (const withManualTask of [false, true]) test(`omitted source preserves existing session-book behavior, mixed manual task: ${withManualTask}`, async t => {
  const args = await fixture(t, { plotWorldbookConfig: null, plotTasks: [task('ordinary-task'),
    ...(withManualTask ? [task('manual-task', manual(['Maproom'], { Maproom: [1] }))] : [])] });
  const { requests } = await turn(t, args);
  assert.equal(body(requests, 'ordinary-task'), '<books>BOUND_ONLY\n\nPUBLIC_ONLY</books>');
  if (withManualTask) assert.equal(body(requests, 'manual-task'), '<books>MANUAL_ONE</books>');
});

test('manual selection retains the embedded character book identity and persistent card id', async t => {
  const args = await fixture(t, ({ card }) => manual(['Bound Canon', card.id], { 'Bound Canon': [0] }));
  const { assets, requests } = await turn(t, args);
  assert.equal(assets.advanceWorldbooks.length, 1);
  assert.equal(assets.advanceWorldbooks[0].id, args.card.id);
  assert.equal(assets.advanceWorldbooks[0].source, 'character');
  assert.equal(body(requests, 'manual-task'), '<books>BOUND_ONLY</books>');
});

test('character mode without an embedded book does not invent a binding from session books', async t => {
  const args = await fixture(t, { plotWorldbookConfig: { source: 'character' } });
  const item = await args.store.item(args.card.id);
  delete item.data.data.character_book;
  await args.store.putItem(item);
  const assets = await sessionAssets(args.store, args.state), requests = [];
  assert.deepEqual(assets.advanceWorldbooks, []);
  const state = structuredClone(args.state);
  await runAdvancePreset({ state, card: assets.card, data: assets.legacy,
    worldbook: await prepareWorldbook(state, assets.card, assets.extraBooks), advanceWorldbooks: [],
    text: '整理资料。', callModel: model(requests, t.name), emit() {}, trace: [], mapConcurrent });
  assert.equal(body(requests, 'character-task'), '<books></books>');
  assert.doesNotMatch(JSON.stringify(requests), /PUBLIC_ONLY/);
});

for (const mode of ['ordinary', 'disabled-task', 'disabled-worldbook', 'character', 'empty-manual']) test(`unused manual loader does not enumerate the library: ${mode}`, async t => {
  const profile = mode === 'ordinary' ? { plotTasks: undefined, promptGroup: [{ role: 'USER', content: '中性推进。' }] }
    : mode === 'disabled-task' ? { plotTasks: [task('manual-task', { enabled: false })] }
    : mode === 'disabled-worldbook' ? { worldbookEnabled: false }
    : mode === 'character' ? { plotWorldbookConfig: { source: 'character' } } : manual([]);
  const args = await fixture(t, { ...manual(['Missing unused source']), ...profile });
  args.store.library = async () => { throw new Error('Unused loader enumerated library'); };
  const { requests, assets } = await turn(t, args);
  assert.deepEqual(assets.extraBooks.map(book => book.id), [args.publicBook.id]);
  assert.doesNotMatch(JSON.stringify(requests), /MANUAL_|LEDGER_|UNSELECTED_LIBRARY/);
});

after(async () => {
  if (process.env.ADVANCE_LOADER_CAPTURE) await writeFile(process.env.ADVANCE_LOADER_CAPTURE, JSON.stringify(captures, null, 2) + '\n');
});
