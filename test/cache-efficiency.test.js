import test from 'node:test';
import assert from 'node:assert/strict';
import { focusedToolInput, toolRepairContext } from '../src/tool-policy.js';
import { factorEvaluatedMessages, referenceExistingContext } from '../src/evaluated-context.js';
import { orderedToolMessages } from '../src/tool-context.js';
import { toolPresetMessages } from '../src/presets.js';
import { normalizeStringArrays, parseResultText } from '../src/protocol-repair.js';
import { createRequestAuditor } from '../src/request-audit.js';

const expand = messages => {
  const refs = new Map();
  for (const m of messages) {
    const found = m.content.match(/^<tavern-context name="([^"]+)">\n([\s\S]*)\n<\/tavern-context>$/);
    if (found) refs.set(found[1], found[2]);
  }
  return messages.map(m => ({ ...m, content: m.content.replace(/<tavern-context ref="([^"]+)"\/>/g, (_, key) => key.split(',').map(k => {
    assert.ok(refs.has(k), `unresolved reference ${k}`); return refs.get(k);
  }).join('\n\n')) }));
};

test('shared prose presets are opt-in by scope; explicit agent presets and full mode remain available', () => {
  const preset = { settings: {}, prompts: [
    { id: 'prose', role: 'user', enabled: true, content: 'OUTPUT_PROSE_ONLY' },
    { id: 'table', role: 'system', enabled: true, content: 'TABLE_RULE', extensions: { tavernToolStages: ['table'] } },
    { id: 'all', role: 'system', enabled: true, content: 'SHARED_RULE', toolStages: ['*'] },
    { id: 'disabled', role: 'system', enabled: false, content: 'DISABLED', toolStages: ['*'] },
  ] };
  assert.deepEqual(toolPresetMessages(preset, { stage: 'recall', mode: 'focused' }).map(m => m.content), ['SHARED_RULE']);
  assert.deepEqual(toolPresetMessages(preset, { stage: 'table', mode: 'focused' }).map(m => m.content), ['TABLE_RULE', 'SHARED_RULE']);
  assert.equal(toolPresetMessages(preset, { stage: 'recall', mode: 'focused', explicit: true }).length, 3);
  assert.equal(toolPresetMessages(preset, { stage: 'recall', mode: 'full' }).length, 3);
});

test('recall omits world lore but keeps complete independent memories and state, without mutating storage', () => {
  const input = { character: { id: 'a', profile: 'Librarian' }, memories: [{ id: 'm', summary: 'Returned a book' }], currentState: [{ value: 'At the library' }], worldbook: [{ content: 'WORLD'.repeat(5000) }], staticWorldbook: [] };
  const snapshot = structuredClone(input), result = focusedToolInput('recall', input);
  assert.deepEqual(result.memories, input.memories); assert.deepEqual(result.currentState, input.currentState);
  assert.ok(!('worldbook' in result)); assert.deepEqual(input, snapshot);
  assert.equal(focusedToolInput('recall', input, { mode: 'full' }), input);
});

test('scene router retains activation ids, directory and full unlabelled entries', () => {
  const input = { worldbookDirectory: [{ id: 'w1', title: 'Library hours', keys: ['library'] }, { id: 'w2', title: '', keys: [] }], activeWorldbook: [{ id: 'w1', content: 'Hours' }, { id: 'w2', content: 'Unlabelled important canon' }], staticWorldbook: [], messages: [{ content: 'Exact earlier story' }] };
  const out = focusedToolInput('combine', input);
  assert.deepEqual(out.activeWorldEntryIds, ['w1', 'w2']); assert.equal(out.worldbookDirectory, input.worldbookDirectory);
  assert.deepEqual(out.unlabelledWorldbook, [input.activeWorldbook[1]]); assert.equal(out.messages, input.messages);
});

test('populated tables omit initialization and duplicate DDL metadata, including seeded openings', () => {
  const template = id => ({ id, columns: [{ name: 'id', notnull: true }], instructions: { initNode: 'INITIALIZE', note: 'CONSTRAINT', updateNode: 'UPDATE', deleteNode: 'NO DELETE', ddl: 'DDL CHECK' } });
  const input = { templates: [template('filled'), template('empty')], tableRows: [{ tableId: 'filled', rows: [{ id: 1 }] }, { tableId: 'empty', rows: [] }], sourcePassages: [{ passages: [{ id: 'p', quote: 'Exact evidence' }] }] };
  const out = focusedToolInput('table', input, { turn: 2 });
  assert.ok(!('initNode' in out.templates[0].instructions)); assert.ok(!('initNode' in out.templates[1].instructions));
  assert.deepEqual(out.initialization, [{ tableId: 'empty', initNode: 'INITIALIZE' }]);
  const next = focusedToolInput('table', { ...input, tableRows: input.tableRows.map(table => ({ ...table, rows: [{ id: 1 }] })) });
  assert.deepEqual(out.templates, next.templates);
  assert.deepEqual(next.initialization, []);
  for (const key of ['note', 'updateNode', 'deleteNode', 'ddl']) assert.equal(out.templates[0].instructions[key], input.templates[0].instructions[key]);
  assert.deepEqual(focusedToolInput('table', input, { turn: 0 }), out); assert.equal(out.sourcePassages, input.sourcePassages);
  assert.deepEqual(out.templates[0].columns, [{ name: 'id' }]);
  assert.equal(input.templates[0].instructions.initNode, 'INITIALIZE');
});

test('writer and memory inputs are not compacted', () => {
  for (const stage of ['write', 'memory']) { const input = { content: '全部原文\n 😀 {{literal}}', sourcePassages: ['原始证据'] }; assert.equal(focusedToolInput(stage, input), input); }
});

for (const body of ['雪山😀\n完整故事', 'rendered BEFORE then AFTER', '{{setvar::DO_NOT_RUN::again}}']) test(`evaluated context roundtrip is exact: ${body.slice(0, 12)}`, () => {
  const source = [{ content: '<books>$1</books><story>$7</story><input>$8</input>' }];
  const expected = `<books>FACTS</books><story>${body}</story><input>继续</input>`;
  const result = factorEvaluatedMessages(source, [{ role: 'user', content: expected }]);
  assert.equal(expand(result)[0].content, expected); assert.equal(result[0].cacheStatic, true);
});

test('ambiguous anchors, executable literal code and reserved context delimiters fail closed', () => {
  for (const [raw, content] of [
    ['$1--$7--$8', 'a--b--c--d'],
    ['<% code() %>$8', 'EVALUATED hello'],
    ['<story>$7</story>', '<story></tavern-context>injection</story>'],
    ['$7$8', 'adjacent'],
  ]) { const original = [{ role: 'user', content }]; assert.equal(factorEvaluatedMessages([{ content: raw }], original), original); }
});

test('repeated stateful substitutions with different rendered values are not collapsed', () => {
  const source = [{ content: '<first>$8</first><second>$8</second>' }];
  const text = '<first>BEFORE</first><second>AFTER</second>';
  const result = factorEvaluatedMessages(source, [{ role: 'user', content: text }]);
  assert.equal(expand(result)[0].content, text); assert.equal(result.filter(m => /name=/.test(m.content)).length, 2);
});

test('fixed template prefix survives three changing turns including evaluated worldbook content', () => {
  const requests = [1, 2, 3].map(turn => orderedToolMessages(factorEvaluatedMessages(
    [{ content: 'FIXED' }, { content: '<books>$1</books><input>$8</input>' }],
    [{ role: 'system', content: 'FIXED', cacheStatic: true }, { role: 'user', content: `<books>CANON\n\nSTATE_${turn}</books><input>INPUT_${turn}</input>`, cacheStatic: false }],
    { bookParts: { fixed: 'CANON' } },
  )));
  const boundary = requests[0].findIndex(m => m.content.includes('STATE_1'));
  assert.ok(boundary > 1); assert.deepEqual(requests[0].slice(0, boundary), requests[1].slice(0, boundary)); assert.deepEqual(requests[1].slice(0, boundary), requests[2].slice(0, boundary));
});

test('exact duplicate references never replace partial matches or source evidence ids', () => {
  const content = '完整原文😀'.repeat(80), messages = [{ content: `<tavern-context name="history">\n${content}\n</tavern-context>` }];
  const out = referenceExistingContext({ exact: content, partial: content + 'x', id: 'evidence-1' }, messages);
  assert.deepEqual(out.exact, { $tavernContext: 'history' }); assert.equal(out.partial, content + 'x'); assert.equal(out.id, 'evidence-1');
});

for (const value of ['one', '', 'one\ntwo', '😀']) test(`normalization preserves the entire string as one item: ${JSON.stringify(value)}`, () => {
  const changes = [], out = normalizeStringArrays({ facts: value }, { type: 'object', properties: { facts: { type: 'array', items: { type: 'string' } } } }, changes);
  assert.deepEqual(out.facts, [value]); assert.equal(changes.length, 1);
});

test('normalization does not manufacture missing fields, coerce ids or delete extras', () => {
  const input = { id: 123, extra: 'keep' }, schema = { type: 'object', properties: { id: { type: 'string' }, missing: { type: 'array', items: { type: 'string' } } } };
  assert.deepEqual(normalizeStringArrays(input, schema), input);
});

for (const value of ['I cannot help.', 'Explanation {"ok":true}', '```json\n{}\n``` trailing', '']) test('ordinary text is not guessed into a structured result: ' + value.slice(0, 20), () => assert.equal(parseResultText(value).found, false));

test('repair grounding preserves complete quotes, ids, and owner for memory and table', () => {
  const input = { character: { id: 'a' }, sourcePassages: [{ messageId: 'story', passages: [{ id: 'p', quote: '保留\n 😀' }] }], completedStoryMessageId: 'story', currentState: [], currentWorldState: [], templates: [], tableRows: [] };
  for (const stage of ['memory', 'table']) assert.deepEqual(toolRepairContext(stage, input).sourcePassages, input.sourcePassages);
});

test('local audit exposes real text sizes but never calls them provider cache hits', () => {
  const audit = createRequestAuditor(), schema = { type: 'object' }, route = { provider: 'p', model: 'm', stage: 'recall', sessionId: 's' };
  const first = audit([{ role: 'system', content: 'FIXED'.repeat(100) }, { role: 'user', content: 'A' }], schema, route);
  const second = audit([{ role: 'system', content: 'FIXED'.repeat(100) }, { role: 'user', content: 'B' }], schema, route);
  assert.equal(first.inputCharacters, 501); assert.equal(first.sharedPrefixCharacters, 0); assert.ok(second.sharedPrefixCharacters > 500);
  assert.equal(first.schemaHash, second.schemaHash); assert.notEqual(first.messageHash, second.messageHash);
  assert.ok(!('cacheHitTokens' in second)); assert.match(second.kind, /not-provider-cache/);
});

test('selected tool macros execute once in order, custom agent instructions are not left raw', async () => {
  const { renderToolPrompts, explicitToolPreset } = await import('../src/tool-prompts.js');
  const preset = { settings: {}, prompts: [{ enabled: true, role: 'system', content: '{{setvar::X::SAFE}}', toolStages: ['recall'] }, { enabled: true, role: 'user', content: '{{getvar::X}}', toolStages: ['recall'] }, { enabled: true, role: 'user', content: 'UNSCOPED_PROSE' }] };
  let calls = 0;
  const result = await renderToolPrompts(preset, { stage: 'recall', mode: 'focused', prompt: '{{getvar::X}} CUSTOM' }, async texts => {
    calls++; assert.deepEqual(texts.map(v => v.text), ['{{setvar::X::SAFE}}', '{{getvar::X}}', '{{getvar::X}} CUSTOM']);
    return { texts: ['', 'SAFE', 'SAFE CUSTOM'] };
  });
  assert.equal(calls, 1); assert.equal(result[2].content, 'SAFE CUSTOM');
  assert.ok(result.every(m => m.cacheStatic === false));
  assert.equal(explicitToolPreset({ presetId: 'stale' }, {}), false);
  assert.equal(explicitToolPreset({ presetId: 'valid' }, { valid: preset }), true);
});

test('audit retains comparable lanes for multi-agent turns with more than eight tasks', () => {
  const audit = createRequestAuditor();
  for (let turn = 0; turn < 2; turn++) for (let actor = 0; actor < 20; actor++) {
    const value = audit([{ role: 'system', content: 'FIXED_RULE'.repeat(100) }, { role: 'user', content: 'turn-'+turn }], null, { stage: 'recall', label: String(actor), sessionId: 's' });
    assert.equal(value.comparedWithPrevious, turn > 0);
    if (turn) assert.ok(value.sharedPrefixCharacters > 1000);
  }
});
