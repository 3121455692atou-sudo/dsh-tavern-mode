import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplates } from '../src/templates.js';
import { applyRegex, expandMacros, macroEnvironment } from '../src/macros.js';
import { normalizeWorldbook } from '../src/worldbook.js';

const rule = { findRegex: 'notice', replaceString: 'updated', placement: [2], promptOnly: true, minDepth: 1, maxDepth: null, trimStrings: [], substituteRegex: 0 };

test('Missing table names and broken if/EJS syntax do not abort rendering', async () => {
  const result = await renderTemplates({ texts: [
    { text: '<if db="db.全局状态表.where(\'row_id\',1).exists()">可见<else>隐藏</if>' },
    { text: '<if db="db.全局状态表.where(\'@\')">坏表达式<else>跳过</if>' },
    { text: 'keep<% @ %>raw', ejs: true },
  ] });
  assert.deepEqual(result.texts, ['隐藏', '跳过', 'keep<% @ %>raw']);
});

test('template compatibility: print writes into the EJS output at the call position', async () => {
  const result = await renderTemplates({ texts: [{ text: 'before:<% print("notice") %>:after' }] });
  assert.equal(result.texts[0], 'before:notice:after');
});

test('template compatibility: getwi scopes a shared entry title to the requested book', async () => {
  const result = await renderTemplates({ env: { worldbook: [
    { world: 'North', uid: 1, comment: 'notice', content: 'north notice' },
    { world: 'South', uid: 1, comment: 'notice', content: 'south notice' },
  ] }, texts: [{ text: '<%= await getwi("South", "notice") %>' }] });
  assert.equal(result.texts[0], 'south notice');
});

test('template compatibility: pick is stable for the same session, content and offset', () => {
  const values = [0.1, 0.9].map(random => expandMacros('{{pick::north::south}}', macroEnvironment({ sessionId: 'reading-room', random: () => random })));
  assert.equal(values[0], values[1]);
});

test('template compatibility: an omitted regex depth does not become zero', () => {
  assert.equal(applyRegex('notice', [rule], { phase: 'prompt' }), 'updated');
  assert.equal(applyRegex('notice', [rule], { phase: 'prompt', depth: 0 }), 'notice');
});

test('template compatibility: the template subprocess preserves an omitted regex depth', async () => {
  const result = await renderTemplates({ regexScripts: [rule], texts: [{ text: 'notice', regexPhase: 'prompt' }] });
  assert.equal(result.texts[0], 'updated');
});

test('template compatibility: upstream print handles multiple values, awaits and real template returns', async () => {
  const result = await renderTemplates({ texts: [
    { text: 'start:<% print("north", " / south", 0, false, null, undefined); for (const x of [1, 2]) print(await Promise.resolve(x)); %>:end' },
    { text: '<% print("discarded"); return "returned"; %>unreachable' },
    { text: '  <%= "<b>notice</b>" %> | <%- "<b>notice</b>" %>\n' },
    { text: '<% print("literal") %>{{user}}', ejs: false, macros: false },
  ] });
  assert.deepEqual(result.texts, ['start:north / south0false12:end', 'returned', '  &lt;b&gt;notice&lt;/b&gt; | <b>notice</b>\n', '<% print("literal") %>{{user}}']);
});

const bookEntries = [
  ...normalizeWorldbook({ name: 'North', entries: [{ uid: 41, comment: 'notice', content: 'north notice', disable: true }] }, 'north-resource'),
  ...normalizeWorldbook({ name: 'South', entries: [
    { uid: 41, comment: 'notice', content: 'south notice', disable: true },
    { uid: 42, comment: 'label', content: '<%= label %>:<%= world_info.world %>:<%= world_info.uid %>' },
    { uid: 43, comment: 'outer', content: '<% print(await getwi("label", { label: "inner" })); %>' },
  ] }, 'south-resource'),
];

test('template compatibility: getwi uses real normalized UID, title and RegExp selectors without cross-book fallback', async () => {
  const env = { worldbook: bookEntries, card: { extensions: { world: 'North' } } };
  const before = structuredClone(env);
  const result = await renderTemplates({ env, texts: [
    { text: '<%= await getwi("South", 41) %>|<%= await getwi("North", /^notice$/) %>|<%= await getwi("South", "^notice$") %>' },
    { text: '<%= await getwi("Missing", "notice") %>|<%= await getwi("North", "unknown") %>' },
  ] });
  assert.deepEqual(result.texts, ['south notice|north notice|south notice', '|']);
  assert.deepEqual(env, before);
});

for (const [name, extra, expected] of [
  ['current entry', { world_info: { world: 'South' }, card: { extensions: { world: 'North' } } }, 'south notice'],
  ['character binding', { card: { extensions: { world: 'North' } }, userLoreBook: 'South', chatLoreBook: 'South' }, 'north notice'],
  ['embedded book', { card: { name: 'Reader', character_book: { name: 'South' } } }, 'south notice'],
  ['persona binding', { userLoreBook: 'North', chatLoreBook: 'South' }, 'north notice'],
  ['chat binding', { chatLoreBook: 'South' }, 'south notice'],
  ['chat metadata binding', { chatMetadata: { world_info: 'North' } }, 'north notice'],
  ['unbound environment', {}, ''],
]) test(`template compatibility: getwi default book follows ${name}`, async () => {
  const result = await renderTemplates({ env: { worldbook: bookEntries, ...extra }, texts: [{ text: '<%= await getwi("notice") %>' }] });
  assert.equal(result.texts[0], expected);
});

test('template compatibility: getwi renders parameters and nested reads in the selected book', async () => {
  const result = await renderTemplates({ env: { worldbook: bookEntries, card: { extensions: { world: 'North' } } }, texts: [
    { text: '<%= await getwi("South", "label", { label: "outer" }) %>' },
    { text: '<%= await getwi("", "notice") %>' },
    { text: '<%= await getwi("South", "outer") %>' },
    { text: '<%- await include("label", { label: "included" }) %>' },
  ] });
  assert.deepEqual(result.texts, ['outer:South:42', 'south notice', 'inner:South:42', 'included:South:42']);
});

test('template compatibility: nested worldbook rendering retains source regex, macros, table queries and variable writeback', async () => {
  const env = { worldbook: [{ world: 'Ledger', uid: 1, comment: 'entry', content: '@@dont_activate\nnotice {{user}}:<% setvar("visits", incvar("visits")); setglobalvar("desk", db.ledger.where("id", 1).value("desk")); print(getvar("visits"), ":", getglobalvar("desk")); %>' }], user: 'Reader', variables: { visits: 2 } };
  const result = await renderTemplates({ env,
    tables: [{ id: 'ledger', headers: ['id', 'desk'], columns: [{ name: 'id' }, { name: 'desk' }], rows: [[1, 'north']] }],
    regexScripts: [{ ...rule, placement: [5], promptOnly: false }],
    texts: [{ text: '<%- await getwi("Ledger", "entry") %>' }, { text: '{{getvar::visits}}:<%= getglobalvar("desk") %>' }],
  });
  assert.deepEqual(result.texts, ['updated Reader:3:north', '3:north']);
  assert.deepEqual(result.variables, { visits: 3 });
  assert.deepEqual(result.globalVariables, { desk: 'north' });
  assert.deepEqual(result.diagnostics, []);
});

test('template compatibility: random remains random while pick does not consume the random callback', () => {
  let calls = 0;
  const env = macroEnvironment({ sessionId: 'reading-room', random: () => calls++ ? 0.9 : 0.1 });
  const first = expandMacros('{{pick::north::south}}', env);
  assert.equal(expandMacros('{{pick::north::south}}', env), first);
  assert.equal(calls, 0);
  assert.equal(expandMacros('{{random::north::south}}', env), 'north');
  assert.equal(expandMacros('{{random::north::south}}', env), 'south');
  assert.equal(calls, 2);
});

test('template compatibility: pick remains stable across independent template processes', async () => {
  const input = { env: { sessionId: 'reading-room' }, texts: [{ text: '{{pick::north::south}} / {{pick: desk, window}}' }] };
  const [first, second] = await Promise.all([renderTemplates(input), renderTemplates(input)]);
  assert.deepEqual(first.texts, second.texts);
  assert.deepEqual(first.diagnostics, []);
});
