import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleWritingPrompt as assemble } from '../src/prompts.js';
import { normalizeWorldbook, activateWorldbookWithEvents } from '../src/worldbook.js';
import { defaultConfig } from '../src/contracts.js';
import { applyRegex } from '../src/macros.js';

// Exercise source transformations before the final prose-length instruction.
// That instruction is tested through both full pipelines in output-policy.test.
const assembleWritingPrompt = options => assemble({ ...options, deferLength: true });

const state = () => ({ id: 'writer-regex', userName: 'Reader', config: defaultConfig(), messages: [{ role: 'user', content: 'Continue.' }], variables: {}, globalVariables: {}, tables: {}, renderMode: 'text' });
const card = { name: 'Actor', extensions: {} };
const script = (extra = {}) => ({ findRegex: 'WORLD_RAW', replaceString: 'WORLD_REPLACED', placement: [5], promptOnly: true, trimStrings: [], ...extra });
const contents = result => result.messages.map(message => message.content);
const markerPreset = (extra = {}) => ({ prompts: ['worldInfoBefore', 'charDescription', 'worldInfoAfter', 'dialogueExamples', 'chatHistory'].map(identifier => ({ identifier, marker: true })), ...extra });

test('writer applies placement 5 regex to activated world info in the assembled request', async () => {
  const worldbook = normalizeWorldbook({ entries: [{ uid: 1, constant: true, content: 'WORLD_RAW', position: 0 }] });
  const result = await assembleWritingPrompt({ state: state(), card, worldbook, regex: [script()] });
  const content = result.messages.map(message => message.content).join('\n');
  assert.ok(content.includes('WORLD_REPLACED'), 'the writer request must contain the placement 5 replacement');
  assert.ok(!content.includes('WORLD_RAW'), 'the active world-info content must be transformed before injection');
});

test('all ordinary world-info positions ignore depth limits and retain their injection positions', async () => {
  const positions = [0, 1, 2, 3, 5, 6];
  const worldbook = normalizeWorldbook({ entries: positions.map(position => ({ uid: position, constant: true, position, depth: 99, content: `WORLD_RAW:${position}` })) });
  const result = await assembleWritingPrompt({ state: state(), card: { ...card, description: 'DESCRIPTION', mes_example: '<START>\nActor: EXAMPLE' }, preset: markerPreset(), worldbook, regex: [script({ minDepth: 2, maxDepth: 2 })] });
  assert.deepEqual(contents(result), ['WORLD_REPLACED:0', 'DESCRIPTION', 'WORLD_REPLACED:1', 'WORLD_REPLACED:5', 'EXAMPLE', 'WORLD_REPLACED:6', 'Continue.', 'WORLD_REPLACED:2', 'WORLD_REPLACED:3']);
});

test('atDepth uses entry depth including zero and the default four, before history clamping', async () => {
  const worldbook = normalizeWorldbook({ entries: [0, 1, 2, 3, 4, undefined, null].map((depth, uid) => ({ uid, constant: true, position: 4, depth, role: uid % 3, content: `WORLD_RAW:${uid}` })) });
  const regex = [script({ minDepth: 0, maxDepth: 0, replaceString: 'ZERO' }), script({ minDepth: 2, maxDepth: 2, replaceString: 'TWO' }), script({ minDepth: 4, maxDepth: 4, replaceString: 'FOUR' })];
  const result = await assembleWritingPrompt({ state: state(), card, preset: markerPreset(), worldbook, regex });
  assert.deepEqual(result.messages, [
    { role: 'user', content: 'WORLD_RAW:1' }, { role: 'assistant', content: 'TWO:2' }, { role: 'system', content: 'WORLD_RAW:3' },
    { role: 'user', content: 'FOUR:4' }, { role: 'assistant', content: 'FOUR:5' }, { role: 'system', content: 'FOUR:6' },
    { role: 'user', content: 'Continue.' }, { role: 'system', content: 'ZERO:0' },
  ]);
});

for (const [name, options, expected] of [
  ['prompt only', { promptOnly: true, markdownOnly: false }, 'WORLD_REPLACED'],
  ['display only', { promptOnly: false, markdownOnly: true }, 'WORLD_RAW'],
  ['both prompt and display', { promptOnly: true, markdownOnly: true }, 'WORLD_REPLACED'],
  ['source only', { promptOnly: false, markdownOnly: false }, 'WORLD_RAW'],
  ['disabled', { disabled: true }, 'WORLD_RAW'],
  ['another placement', { placement: [2] }, 'WORLD_RAW'],
]) test(`writer honors world-info regex switch: ${name}`, async () => {
  const worldbook = normalizeWorldbook({ entries: [{ uid: 1, constant: true, content: 'WORLD_RAW' }] });
  const result = await assembleWritingPrompt({ state: state(), card, preset: markerPreset(), worldbook, regex: [script(options)] });
  assert.deepEqual(contents(result), [expected, 'Continue.']);
});

test('omitted and null regex depth retain the existing depth gate while explicit zero is gated', () => {
  const rules = [script({ minDepth: 1, maxDepth: 2 })];
  assert.equal(applyRegex('WORLD_RAW', rules, { placement: 5, phase: 'prompt' }), 'WORLD_REPLACED');
  assert.equal(applyRegex('WORLD_RAW', rules, { placement: 5, phase: 'prompt', depth: null }), 'WORLD_REPLACED');
  assert.equal(applyRegex('WORLD_RAW', rules, { placement: 5, phase: 'prompt', depth: 0 }), 'WORLD_RAW');
});

test('regex uses configured extra/preset/card scope order and shares replacement macro variables with final EJS', async () => {
  const input = state();
  input.variables = { needle: 'WORLD_RAW', phase: 'before', steps: 0 };
  input.globalVariables = { desk: 'north' };
  const worldbook = normalizeWorldbook({ name: 'Ledger', entries: [{ uid: 1, constant: true, content: 'WORLD_RAW' }] });
  const extra = script({ findRegex: '{{getvar::needle}}', substituteRegex: 2, replaceString: 'A{{incvar::steps}}/{{getvar::phase}}/{{user}}/{{getglobalvar::desk}}' });
  const localCard = { ...card, extensions: { regex_scripts: [script({ findRegex: '^B', replaceString: 'C{{incvar::steps}}' })] } };
  const preset = markerPreset({ extensions: { regex_scripts: [script({ findRegex: '^A', replaceString: 'B{{incvar::steps}}' })] } });
  preset.prompts.unshift({ identifier: 'init', content: '{{setvar::phase::after}}' });
  preset.prompts.push({ identifier: 'check', content: '<% print(getvar("steps"), ":", getvar("phase"), ":", getglobalvar("desk")); %>' });
  const before = structuredClone({ input, worldbook, localCard, preset, extra });
  const result = await assembleWritingPrompt({ state: input, card: localCard, preset, worldbook, regex: [extra] });
  assert.deepEqual(contents(result), ['C321/before/Reader/north', 'Continue.', '3:after:north']);
  assert.deepEqual(result.variables, { needle: 'WORLD_RAW', phase: 'after', steps: 3 });
  assert.deepEqual(result.globalVariables, { desk: 'north' });
  input.regexOrder = [1, 2, 0];
  const reordered = await assembleWritingPrompt({ state: input, card: localCard, preset, worldbook, regex: [extra] });
  assert.deepEqual(contents(reordered), ['A1/before/Reader/north', 'Continue.', '1:after:north']);
  delete input.regexOrder;
  assert.deepEqual({ input, worldbook, localCard, preset, extra }, before);
});

test('world-info regex stays per entry and precedes the existing condition, macro and EJS rendering', async () => {
  const input = state();
  input.variables = { phase: 'before', steps: 0 };
  const worldbook = normalizeWorldbook({ name: 'Ledger', entries: [
    { uid: 1, comment: 'notice', constant: true, content: '<if db="true">WORLD_RAW {{getvar::phase}} <%= getvar("phase") %><else>HIDDEN</if>' },
    { uid: 2, constant: true, content: '<%= "WORLD_RAW" %>' },
    { uid: 3, constant: true, content: 'LEFT', order: 101 },
    { uid: 4, constant: true, content: 'RIGHT', order: 102 },
  ] });
  const preset = markerPreset();
  preset.prompts.unshift({ identifier: 'init', content: '{{setvar::phase::after}}' });
  preset.prompts.push({ identifier: 'read', content: '<%- await getwi("Ledger", "notice") %>' });
  const localCard = { ...card, description: 'WORLD_RAW' };
  input.messages[0].content = 'WORLD_RAW';
  const regex = [script({ findRegex: 'WORLD_RAW (?=\\{\\{)', replaceString: 'WI={{getvar::phase}}' }), script({ findRegex: '^WORLD_RAW$', replaceString: 'LATE' }), script({ findRegex: 'LEFT\\s+RIGHT', replaceString: 'JOINED' })];
  const result = await assembleWritingPrompt({ state: input, card: localCard, preset, worldbook, regex });
  assert.deepEqual(contents(result), ['LEFT', 'RIGHT', 'WORLD_RAW', 'WI=beforeafter after', 'WORLD_RAW', 'WORLD_RAW', '<if db="true">WORLD_RAW after after<else>HIDDEN</if>']);
  assert.deepEqual(result.variables, { phase: 'after', steps: 0 });
  assert.deepEqual(result.diagnostics, []);
});

test('disabled or nonmatching regex leaves the complete request, macro order and source entries unchanged', async () => {
  const input = state();
  const worldbook = normalizeWorldbook({ entries: [{ uid: 1, constant: true, content: '{{incvar::count}}/<% print(incvar("count")); %>/{{unknown_macro}}' }] });
  const preset = markerPreset();
  preset.prompts.unshift({ identifier: 'init', content: '{{setvar::count::2}}' });
  const before = structuredClone({ input, worldbook });
  const baseline = await assembleWritingPrompt({ state: input, card, preset, worldbook });
  assert.deepEqual(contents(baseline), ['3/4/{{unknown_macro}}', 'Continue.']);
  for (const regex of [[script({ findRegex: '[', disabled: true })], [script({ findRegex: '^UNMATCHED$' })]]) {
    assert.deepEqual(await assembleWritingPrompt({ state: input, card, preset, worldbook, regex }), baseline);
  }
  assert.deepEqual({ input, worldbook }, before);
});

test('regex follows scan listeners without changing recursive activation, source objects or empty-result activation', async () => {
  const input = state();
  input.variables = { replacement: 'before' };
  const worldbook = [
    ...normalizeWorldbook({ name: 'Bound', entries: [
      { uid: 1, constant: true, content: 'TRIGGER', order: 10 },
      { uid: 2, key: ['TRIGGER'], content: 'WORLD_RAW', order: 20 },
      { uid: 3, key: ['WORLD_REPLACED'], content: 'REGEX_RECURSION', order: 30 },
      { uid: 4, constant: true, disable: true, content: 'DISABLED' },
      { uid: 5, key: ['unmatched'], content: '{{incvar::inactive}}' },
    ] }),
    ...normalizeWorldbook({ name: 'Extra', entries: [{ uid: 1, constant: true, content: 'EMPTY', order: 40 }] }, 'resource'),
  ];
  const before = structuredClone({ input, worldbook });
  let scanned, scannedBefore;
  const result = await assembleWritingPrompt({ state: input, card, worldbook, regex: [
    script({ findRegex: 'TRIGGER', replaceString: 'WORLD_REPLACED' }),
    script({ findRegex: 'EDITED', replaceString: '{{getvar::replacement}}', minDepth: 2, maxDepth: 2 }),
    script({ findRegex: '^EMPTY$', replaceString: '' }),
    script({ findRegex: 'WORLD_RAW', replaceString: 'UNEXPECTED' }),
  ], scanWorldbook: async ({ entries, options }) => {
    scanned = await activateWorldbookWithEvents(entries, options, async (name, data) => {
      if (name === 'worldinfo_scan_done' && !data.state.next) {
        const entry = data.activated.entries.get('Bound.2');
        entry.content = 'EDITED'; entry.position = 4; entry.depth = 2; entry.role = 2;
      }
    });
    scanned.variables = { replacement: 'from-listener' };
    scannedBefore = structuredClone(scanned);
    return scanned;
  } });
  assert.deepEqual(result.worldEntryIds, ['card:1', 'card:2', 'resource:1']);
  assert.equal(result.worldEntries, scanned.entries);
  assert.equal(result.worldActivation, scanned.history);
  assert.deepEqual(scanned, scannedBefore);
  assert.deepEqual({ input, worldbook }, before);
  assert.deepEqual(contents(result).slice(1), ['WORLD_REPLACED', 'from-listener', 'Continue.']);
  assert.equal(result.messages.find(message => message.content === 'from-listener').role, 'assistant');
  assert.deepEqual(result.worldEntries.map(entry => [entry.id, entry.world, entry.originalId, entry.content]), [['card:1', 'Bound', 1, 'TRIGGER'], ['card:2', 'Bound', 2, 'EDITED'], ['resource:1', 'Extra', 1, 'EMPTY']]);
  assert.deepEqual(result.variables, { replacement: 'from-listener' });
});
