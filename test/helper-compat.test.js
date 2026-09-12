import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { transform } from 'esbuild';
import _ from 'lodash';
import { createHash } from 'node:crypto';
import { buildHelper, helperFiles } from '../src/helper-build.js';
import { openHelper } from '../src/helper-update.js';

const project = resolve('.'), work = join(project, '.work/acceptance-helper-compat');
await mkdir(work, { recursive: true });
const temporary = await mkdtemp(join(work, 'test-'));
await buildHelper(join(project, 'vendor/tavern-helper'), join(temporary, 'helper.js'));
const bundle = (await transform(await readFile(join(temporary, 'helper.js'), 'utf8'), { format: 'cjs' })).code;
const realm = await readFile(process.env.HELPER_COMPAT_REALM_PATH ?? join(project, 'src/realm.js'), 'utf8');
const observations = [];
test.after(async () => {
  await rm(temporary, { recursive: true, force: true });
  if (process.env.HELPER_COMPAT_EVIDENCE_PATH) await writeFile(process.env.HELPER_COMPAT_EVIDENCE_PATH, JSON.stringify(observations, null, 2) + '\n');
});

// Execute the actual realm event bus, storage adapter and helper installation.
// Only the UI, transport and dynamic module loader are in-memory test boundaries.
function section(start, end) {
  const from = realm.indexOf(start), to = realm.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing realm boundary: ${start}`);
  return realm.slice(from, to);
}
async function harness(entries, { character = false, persist = async () => {}, runtime = bundle } = {}) {
  const writes = [], errors = [];
  const book = { name: 'Fixture', entries: structuredClone(entries) };
  const payload = { cardId: 'fixture-card', card: { name: 'Actor', ...(character ? { character_book: book } : {}) }, worldbooks: character ? [] : [{ id: 'fixture-book', name: book.name, data: book }], presets: [], state: {} };
  const ui = { val: () => undefined, find: () => ui, trigger: () => ui };
  const sandbox = createContext({ _, console, structuredClone, setTimeout, clearTimeout, Response, crypto, payload, writes, errors, persist, $: () => ui });
  sandbox.window = sandbox;
  sandbox.importHelper = async () => {
    return runInContext(`(function(module) { ${runtime}\n; return module.exports; })({ exports: {} })`, sandbox, { filename: 'real-vendor-helper.cjs' });
  };
  await runInContext(`(async () => {
    let running = false, officialHelper;
    const listeners = Object.create(null), clone = structuredClone;
    const report = error => errors.push(error.message ?? String(error));
    async function write(method, args) { await persist(method, args); writes.push(clone({ method, args })); }
    ${section('function eventOn(', 'const context =')}
    const context = { chat: [], characters: [], eventSource, event_types, extension_settings: {}, chatCompletionSettings: {}, name2: 'Actor' };
    const saveSettings = async () => {}, promptManager = { render() {} };
    ${section('function primaryWorldbook()', 'function initializeGlobal(')}
    const functions = {
      getTavernVersion: () => 'fixture-host', substituteParams: text => text,
      ${section('  getWorldbook: async', '  setLorebookSettings:')}
    };
    ${section('async function loadOfficialHelper()', 'async function dispatch(').replace("import('/tavern-helper.js')", 'importHelper()')}
    Object.assign(window, { testHost: { context, functions, payload, eventSource, rawWorldbook, setRunning(value) { running = value; } } });
    await loadOfficialHelper();
  })()`, sandbox, { filename: 'real-realm-host.js' });
  return { api: sandbox, host: sandbox.testHost, writes, errors };
}
const rawEntry = (uid, fields = {}) => ({ uid, displayIndex: uid, comment: `Entry ${uid}`, key: ['match'], keysecondary: [], content: `Content ${uid}`, disable: false, constant: true, vectorized: false, selective: true, selectiveLogic: 0, position: 0, role: 0, depth: 4, order: 100, probability: 100, useProbability: true, scanDepth: null, caseSensitive: null, matchWholeWords: null, useGroupScoring: null, automationId: '', excludeRecursion: false, preventRecursion: false, delayUntilRecursion: 0, group: '', groupOverride: false, groupWeight: 100, sticky: 0, cooldown: 0, delay: 0, ...fields });
const plain = value => structuredClone(value);

test('Real legacy helper converts, filters, sets and asynchronously updates persisted entries', async () => {
  const { api, writes } = await harness([rawEntry(7), rawEntry(11, { disable: true, vectorized: true, constant: false, position: 4, role: 2, depth: 0, scanDepth: 0, selectiveLogic: 3 })]);
  const before = await api.getLorebookEntries('Fixture');
  assert.deepEqual(plain(before.map(({ uid, enabled, type, position, scan_depth }) => ({ uid, enabled, type, position, scan_depth }))), [
    { uid: 7, enabled: true, type: 'constant', position: 'before_character_definition', scan_depth: 'same_as_global' },
    { uid: 11, enabled: false, type: 'vectorized', position: 'at_depth_as_assistant', scan_depth: 0 },
  ]);
  assert.deepEqual(plain((await api.getLorebookEntries('Fixture', { filter: { enabled: false } })).map(e => e.uid)), [11]);
  before[0].keys.push('outside');
  assert.deepEqual(plain((await api.getLorebookEntries('Fixture'))[0].keys), ['match']);
  const set = await api.setLorebookEntries('Fixture', [{ uid: 11, enabled: true, position: 'at_depth_as_user', type: 'selective', logic: 'not_all', filters: ['other'], scan_depth: 'same_as_global', content: 'updated' }]);
  assert.equal(set[1].enabled, true); assert.equal(set[1].position, 'at_depth_as_user');
  assert.equal(set[1].logic, 'not_all'); assert.equal(set[1].scan_depth, 'same_as_global');
  assert.equal(writes.at(-1).args.entries[1].disable, false);
  assert.equal(writes.at(-1).args.entries[1].position, 4); assert.equal(writes.at(-1).args.entries[1].role, 1);
  const updated = await api.updateLorebookEntriesWith('Fixture', async entries => { await Promise.resolve(); entries[0].content = 'async update'; return entries; });
  assert.equal(updated[0].content, 'async update');
  assert.deepEqual(plain(await api.getLorebookEntries('Fixture')), plain(updated));
  assert.equal(await api.replaceLorebookEntries('Fixture', updated), undefined);
  assert.deepEqual(plain(await api.getLorebookEntries('Fixture')), plain(updated));
  await assert.rejects(api.getLorebookEntries('Missing'), /世界书/);
  observations.push({ id: 'legacy-field-roundtrip', before, persisted: writes.at(-1).args.entries, after: await api.getLorebookEntries('Fixture') });
});

test('Real official event exports reach the realm host with awaited and synchronous dispatch semantics', async () => {
  const { api, host } = await harness([]);
  const order = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  api.eventOn('waited', async value => { order.push(`first:${value}`); await gate; order.push('first:end'); });
  api.eventOn('waited', () => order.push('second'));
  let complete = false;
  const pending = api.eventEmit('waited', 42).then(() => { complete = true; });
  await Promise.resolve();
  assert.equal(complete, false); assert.deepEqual(order, ['first:42']);
  release(); await pending;
  assert.deepEqual(order, ['first:42', 'first:end', 'second']);
  const awaitedOrder = [...order];
  order.length = 0;
  api.eventOn('sync', async () => { order.push('first'); await Promise.resolve(); order.push('later'); });
  api.eventOn('sync', () => order.push('second'));
  assert.equal(api.eventEmitAndWait('sync'), undefined);
  assert.deepEqual(order, ['first', 'second']);
  const synchronousOrder = [...order];
  await Promise.resolve(); assert.deepEqual(order, ['first', 'second', 'later']);
  assert.equal(typeof host.eventSource.emitAndWait, 'function');
  observations.push({ id: 'official-event-exports', awaitedOrder, synchronousOrder, afterMicrotask: [...order], emitAndWaitReturn: 'void' });
});

test('Official once/off/clear and host once removal respect listener ownership', async () => {
  const { api, host } = await harness([]);
  let once = 0, removed = 0;
  const listener = () => { removed++; };
  api.eventOnce('event', async () => { await Promise.resolve(); once++; });
  api.eventOn('event', listener);
  api.eventRemoveListener('event', listener);
  await api.eventEmit('event'); await api.eventEmit('event');
  assert.equal(once, 1); assert.equal(removed, 0);
  host.eventSource.once('host', listener); host.eventSource.off('host', listener);
  await host.eventSource.emit('host'); assert.equal(removed, 0);
  api.eventOn('clear', listener); api.eventClearAll(); await api.eventEmit('clear');
  assert.equal(removed, 0);
});

test('New worldbook API preserves its nested protocol, regexes, implicit fields, ordering and extra data', async () => {
  const filter = { isExclude: false, names: [], tags: [] };
  const { api, writes, host } = await harness({ 8: rawEntry(8, { displayIndex: 1, characterFilter: filter }), 3: rawEntry(3, { displayIndex: 0, position: 7, constant: false, vectorized: true, key: ['/hello\\/world/i', '/invalid/z', 'text'], useProbability: false, probability: 12, ignoreBudget: true, outletName: 'outlet', groupWeight: 77, caseSensitive: true, extra: { private: ['kept'] }, characterFilter: filter }) });
  const original = await api.getWorldbook('Fixture');
  assert.deepEqual(plain(original.map(e => e.uid)), [3, 8]);
  assert.equal(original[0].position.type, 'outlet'); assert.equal(original[0].probability, 100);
  assert.equal(original[0].strategy.keys[0].source, 'hello\\/world');
  assert.equal(original[0].strategy.keys[1], '/invalid/z');
  assert.equal(original[0].ignoreBudget, true); assert.equal(original[0].groupWeight, 77);
  assert.deepEqual(plain(original[0].extra), { private: ['kept'] });
  original[0].enabled = false;
  original[0].strategy.scan_depth = 0;
  original[0].strategy.keys_secondary = { logic: 'and_all', keys: [/secondary/i] };
  original[0].position = { type: 'at_depth', role: 'assistant', depth: 0, order: 33 };
  original[0].recursion = { prevent_incoming: true, prevent_outgoing: true, delay_until: 2 };
  original[0].effect = { sticky: 2, cooldown: 3, delay: 4 };
  assert.equal(await api.replaceWorldbook('Fixture', original, { render: 'immediate' }), undefined);
  assert.deepEqual(plain(await api.getWorldbook('Fixture')), plain(original));
  assert.deepEqual(plain(await host.context.getWorldbook('Fixture')), plain(original));
  assert.equal(writes.at(-1).args.entries[0].uid, 3);
  assert.equal(writes.at(-1).args.entries[0].scanDepth, 0);
  assert.equal(writes.at(-1).args.entries[0].role, 2);
  const updated = await api.updateWorldbookWith('Fixture', async entries => { await Promise.resolve(); entries[0].content = 'nested update'; return entries; });
  assert.equal(updated[0].content, 'nested update');
  const legacy = await api.getLorebookEntries('Fixture');
  assert.equal(legacy[0].enabled, false); assert.equal(legacy[0].position, 'at_depth_as_assistant');
  assert.equal(legacy[0].scan_depth, 0);
  observations.push({ id: 'new-worldbook-roundtrip', persisted: writes.at(-1).args.entries, nested: updated, legacy });
});

test('Character Book conversion uses upstream fields once and persists canonical uid/enable changes', async () => {
  const entry = { id: 0, keys: ['cc'], secondary_keys: ['filter'], comment: 'Character entry', content: 'CC', enabled: false, insertion_order: 22, position: 'before_char', extensions: { position: 4, role: 1, depth: 0, scan_depth: 0, selectiveLogic: 2, probability: 44, useProbability: true, vectorized: true, exclude_recursion: true, prevent_recursion: true, case_sensitive: true, group_weight: 78 } };
  const { api, host, writes } = await harness([entry], { character: true });
  const legacy = (await api.getLorebookEntries('Fixture'))[0];
  assert.equal(legacy.uid, 0); assert.equal(legacy.enabled, false); assert.equal(legacy.type, 'vectorized');
  assert.equal(legacy.position, 'at_depth_as_user'); assert.equal(legacy.scan_depth, 0); assert.equal(legacy.depth, 0);
  assert.equal(legacy.logic, 'not_any'); assert.equal(legacy.group_weight, 78);
  assert.equal(Object.hasOwn(host.payload.card.character_book.entries[0], 'uid'), false);
  await api.setLorebookEntries('Fixture', [{ uid: 0, enabled: true, position: 'after_example_messages', keys: ['new'], filters: [], scan_depth: 2 }]);
  const after = (await api.getWorldbook('Fixture'))[0];
  assert.equal(after.enabled, true); assert.equal(after.uid, 0); assert.equal(after.position.type, 'after_example_messages');
  assert.equal(after.strategy.scan_depth, 2); assert.deepEqual(plain(after.strategy.keys), ['new']);
  assert.equal(writes[0].args.primary, true);
  assert.equal(writes[0].args.entries[0].disable, false);
  assert.equal(writes[0].args.entries[0].position, 6);
  assert.deepEqual(plain(api.getCharLorebooks({ name: 'Actor' })), { primary: 'Fixture', additional: [] });
  assert.deepEqual(plain(api.getCharWorldbookNames('current')), { primary: 'Fixture', additional: [] });
  assert.throws(() => api.getCharLorebooks({ name: 'Unloaded' }), /未找到/);
  const reloaded = await harness(writes[0].args.entries, { character: true });
  assert.deepEqual(plain(await reloaded.api.getWorldbook('Fixture')), plain(await api.getWorldbook('Fixture')));
  observations.push({ id: 'character-book-persistence', source: entry, before: legacy, write: writes[0], after });
});

test('Whole Character Book conversion retains display indexes independently of numeric uid order', async () => {
  const { api } = await harness([17, 3].map(id => ({ id, keys: [], content: `CC ${id}`, enabled: true, insertion_order: 100, position: 'before_char' })), { character: true });
  assert.deepEqual(plain((await api.getWorldbook('Fixture')).map(entry => entry.uid)), [17, 3]);
  assert.deepEqual(plain((await api.getLorebookEntries('Fixture')).map(({ uid, display_index }) => ({ uid, display_index }))), [{ uid: 3, display_index: 1 }, { uid: 17, display_index: 0 }]);
});

test('New and legacy create/delete signatures and singular aliases remain distinct', async () => {
  const { api } = await harness([rawEntry(9)]);
  const created = await api.createWorldbookEntries('Fixture', [{ uid: 9, content: 'collision' }, { uid: 0, content: 'new' }]);
  assert.equal(created.worldbook.length, 3); assert.equal(created.new_entries.length, 2);
  assert.equal(new Set(created.worldbook.map(e => e.uid)).size, 3);
  assert.equal(created.new_entries[0].uid, 10); assert.equal(created.new_entries[1].uid, 0);
  assert.equal(created.new_entries[0].strategy.type, 'constant'); assert.equal(created.new_entries[0].position.type, 'at_depth');
  const deleted = await api.deleteWorldbookEntries('Fixture', entry => entry.uid === 10);
  assert.deepEqual(plain(deleted.deleted_entries.map(e => e.uid)), [10]);
  const legacy = await api.createLorebookEntries('Fixture', [{ content: 'legacy', enabled: false }]);
  assert.equal(legacy.new_uids.length, 1); assert.equal(legacy.entries.length, 3);
  assert.equal(legacy.entries.find(e => e.uid === legacy.new_uids[0]).enabled, false);
  const uid = await api.createLorebookEntry('Fixture', { content: 'singular' });
  assert.equal(typeof uid, 'number');
  assert.equal(await api.deleteLorebookEntry('Fixture', uid), true);
  assert.equal(await api.deleteLorebookEntry('Fixture', uid), false);
  const removed = await api.deleteLorebookEntries('Fixture', legacy.new_uids);
  assert.equal(removed.delete_occurred, true); assert.equal(removed.entries.length, 2);
  observations.push({ id: 'new-and-legacy-signatures', newCreateKeys: Object.keys(created), newDeleteKeys: Object.keys(deleted), legacyCreateKeys: Object.keys(legacy), legacyDeleteKeys: Object.keys(removed), collisionUids: created.worldbook.map(e => e.uid), singularCreateUid: uid });
});

test('All official legacy position, strategy, logic and global sentinel enums round trip', async () => {
  const { api } = await harness([]);
  const positions = ['before_character_definition', 'after_character_definition', 'before_author_note', 'after_author_note', 'before_example_messages', 'after_example_messages', 'at_depth_as_system', 'at_depth_as_user', 'at_depth_as_assistant'];
  const entries = positions.flatMap((position, i) => ['constant', 'selective', 'vectorized'].map((type, j) => ({ uid: i * 3 + j, position, type, enabled: j !== 1, depth: 0, logic: ['and_any', 'not_all', 'not_any', 'and_all'][i % 4], scan_depth: i % 2 ? 0 : 'same_as_global', case_sensitive: i % 2 ? false : 'same_as_global', match_whole_words: true, use_group_scoring: false, automation_id: 'automation', exclude_recursion: true, prevent_recursion: false, delay_until_recursion: 2, content: `${i}:${j}`, group: 'group', group_weight: 32, group_prioritized: true, sticky: 3, cooldown: 4, delay: 5 })));
  await api.replaceLorebookEntries('Fixture', entries);
  const read = await api.getLorebookEntries('Fixture');
  for (const expected of entries) {
    const actual = read.find(e => e.uid === expected.uid);
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(plain(actual[key]), key === 'depth' && !expected.position.startsWith('at_depth') ? null : value, `${expected.uid}.${key}`);
  }
  await api.updateLorebookEntriesWith('Fixture', entries => entries);
  assert.deepEqual(plain(await api.getLorebookEntries('Fixture')), plain(read));
  observations.push({ id: 'legacy-enums', cases: read.length, entries: read });
});

test('Writes are awaited, failures stay visible, and running updates use only the session override', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { api, host, writes } = await harness([rawEntry(0)], { persist: () => gate });
  let published = false, finished = false;
  api.eventOn(api.tavern_events.WORLDINFO_UPDATED, async () => { await Promise.resolve(); published = true; });
  const pending = api.updateWorldbookWith('Fixture', entries => { entries[0].content = 'persisted'; return entries; }).then(value => { finished = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false); assert.equal(published, false);
  assert.equal((await api.getWorldbook('Fixture'))[0].content, 'Content 0');
  release(); await pending;
  assert.equal(published, true); assert.equal(writes.length, 1);
  const failed = await harness([rawEntry(0)], { persist: async () => { throw Error('fixture persistence failure'); } });
  await assert.rejects(failed.api.setLorebookEntries('Fixture', [{ uid: 0, content: 'lost' }]), /fixture persistence failure/);
  assert.equal((await failed.api.getWorldbook('Fixture'))[0].content, 'Content 0');
  assert.equal(failed.writes.length, 0);
  host.setRunning(true);
  await api.updateWorldbookWith('Fixture', entries => { entries[0].content = 'during generation'; return entries; });
  assert.equal(writes.length, 1);
  assert.equal(host.payload.state.worldbookOverrides['fixture-book'][0].content, 'during generation');
  observations.push({ id: 'awaited-persistence-and-session-override', persistedWrites: writes.length, failedWrites: failed.writes.length, failedReadback: await failed.api.getWorldbook('Fixture'), sessionOverride: host.payload.state.worldbookOverrides });
});

test('Event registration stop handles, reorder, duplicate registration and error paths reach real host listeners', async () => {
  const { api, host, errors } = await harness([]);
  const order = [], first = () => order.push('first'), last = () => order.push('last');
  api.eventOn('ordered', first); api.eventOn('ordered', first); api.eventOn('ordered', last);
  api.eventMakeFirst('ordered', last); await api.eventEmit('ordered');
  assert.deepEqual(order, ['last', 'first']);
  order.length = 0; api.eventMakeLast('ordered', last); await api.eventEmit('ordered');
  assert.deepEqual(order, ['first', 'last']);
  const stop = api.eventOn('stopped', first); stop.stop();
  order.length = 0; await api.eventEmit('stopped'); assert.deepEqual(order, []);
  const stopOnce = api.eventOnce('stopped-once', first); stopOnce.stop();
  await api.eventEmit('stopped-once'); assert.deepEqual(order, []);
  assert.equal(host.eventSource.events['stopped-once'].length, 0);
  api.eventOn('failure', () => { throw Error('listener failure'); });
  await assert.rejects(api.eventEmit('failure'), /listener failure/);
  api.eventOn('failure', () => order.push('continued'));
  api.eventEmitAndWait('failure'); assert.deepEqual(order, ['continued']);
  assert.deepEqual(errors, ['listener failure']);
  observations.push({ id: 'event-ownership-and-errors', stoppedListeners: host.eventSource.events.stopped.length, stoppedOnceListeners: host.eventSource.events['stopped-once'].length, errors });
});

test('Every vendored helper dependency and host fragment is hashed, and auto updates execute both real protocols', async () => {
  const upstream = JSON.parse(await readFile(join(project, 'vendor/tavern-helper/upstream.json'), 'utf8'));
  assert.deepEqual([...helperFiles].sort(), Object.keys(upstream.files).sort());
  for (const [name, hash] of Object.entries(upstream.files)) assert.equal(createHash('sha256').update(await readFile(join(project, 'vendor/tavern-helper', name))).digest('hex'), hash, name);
  const hostUpstream = JSON.parse(await readFile(join(project, 'vendor/tavern-helper/host/upstream.json'), 'utf8'));
  for (const [name, hash] of Object.entries(hostUpstream.files)) assert.equal(createHash('sha256').update(await readFile(join(project, 'vendor/tavern-helper/host', name))).digest('hex'), hash, name);
  const fetched = [], commit = 'a'.repeat(40);
  let missing = false;
  const helper = await openHelper(project, join(temporary, 'updated'), { fetch: async url => {
    if (url.includes('/commits/')) return Response.json({ sha: missing ? 'b'.repeat(40) : commit });
    const name = url.split('/').slice(6).join('/'); fetched.push(name);
    if (missing && name === 'src/function/lorebook_entry.ts') return new Response('missing', { status: 404 });
    return new Response(await readFile(join(project, 'vendor/tavern-helper', name)));
  } });
  await helper.check();
  assert.deepEqual([...new Set(fetched)].sort(), [...helperFiles].sort());
  const runtimePath = helper.bundle();
  const runtime = (await transform(await readFile(runtimePath, 'utf8'), { format: 'cjs' })).code;
  const { api } = await harness([rawEntry(12)], { runtime });
  assert.equal((await api.getLorebookEntries('Fixture'))[0].type, 'constant');
  await api.setLorebookEntries('Fixture', [{ uid: 12, enabled: false }]);
  assert.equal((await api.getWorldbook('Fixture'))[0].enabled, false);
  await api.updateWorldbookWith('Fixture', entries => { entries[0].content = 'updated runtime'; return entries; });
  assert.equal((await api.getLorebookEntries('Fixture'))[0].content, 'updated runtime');
  let emitted = 0; api.eventOnce('updated', () => { emitted++; }); api.eventEmitAndWait('updated');
  assert.equal(emitted, 1);
  missing = true; await assert.rejects(helper.check(), /HTTP 404/);
  assert.equal(helper.bundle(), runtimePath);
  assert.equal((await openHelper(project, join(temporary, 'updated'))).bundle(), runtimePath);
  observations.push({ id: 'auto-update', fetched: [...new Set(fetched)], status: helper.status(), after: await api.getLorebookEntries('Fixture'), retainedRuntimeAfterMissingSource: helper.bundle() === runtimePath });
});

test('Helper worldbook validation follows changes to the loaded book list', async () => {
  const { api, host } = await harness([]);
  host.payload.worldbooks.push({ id: 'second', name: 'Second', data: { entries: [rawEntry(42)] } });
  assert.deepEqual(plain(api.getWorldbookNames()), ['Fixture', 'Second']);
  assert.equal((await api.getLorebookEntries('Second'))[0].uid, 42);
  assert.equal((await api.getWorldbook('Second'))[0].uid, 42);
  host.payload.worldbooks.pop();
  await assert.rejects(api.getLorebookEntries('Second'), /世界书/);
  observations.push({ id: 'dynamic-worldbook-list', afterRemoval: api.getWorldbookNames() });
});

test('An installed runtime built with a previous adapter cannot silently mask new source dependencies', async () => {
  const root = join(temporary, 'previous-adapter'), directory = join(root, 'tavern-helper'), commit = 'c'.repeat(40);
  await mkdir(join(directory, commit), { recursive: true });
  await writeFile(join(directory, 'status.json'), JSON.stringify({ version: '4.9.5', commit, bundled: false, autoUpdate: false, adapterHash: 'previous-adapter' }));
  await writeFile(join(directory, commit, 'runtime.js'), 'export const api = {};');
  const helper = await openHelper(project, root);
  assert.equal(helper.status().bundled, true);
  assert.equal(helper.status().autoUpdate, false);
  assert.equal(helper.bundle(), join(project, 'lib/tavern-helper.js'));
  assert.equal(await readFile(join(directory, commit, 'runtime.js'), 'utf8'), 'export const api = {};');
  observations.push({ id: 'previous-adapter-runtime', status: helper.status(), previousRuntimeRetained: true });
});
