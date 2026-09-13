import { expandedMessages } from './helpers/tool-context.js';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { runAdvancePreset } from '../src/advance.js';
import { defaultConfig } from '../src/contracts.js';
import { mapConcurrent } from '../src/pipeline.js';
import { normalizeWorldbook } from '../src/worldbook.js';

const captures = [];
const prompt = '<books>$1</books><tables>$5</tables><prior>$6</prior><history>$7</history><input>$8</input><persona>$U</persona><card>$C</card>';
const marked = value => `${value}<profile>PROFILE_${value}</profile><task>TASK_${value}</task>`;
const rule = name => [{ start: `<${name}>`, end: `</${name}>` }];
function fixture(profile = {}, task = {}) {
  const book = (name, prefix) => normalizeWorldbook({ name, entries: [
    { uid: 0, content: `${name}_ZERO`, constant: true },
    { uid: 1, content: `${name}_ONE`, constant: true },
    { uid: 2, content: `${name}_DISABLED`, constant: true, disable: true },
  ] }, prefix);
  return {
    state: { id: 'advance-config-fixture', legacyId: 'profile', userName: '访客', persona: marked('PERSONA'),
      messages: [{ role: 'assistant', content: marked('EARLIER') }, { role: 'user', content: 'PAST_USER' },
        { role: 'assistant', content: marked('LATEST') }, { role: 'assistant', is_hidden: true, content: 'HIDDEN' }],
      tables: { sheet_state: { name: '登记状态', content: [['状态'], [marked('TABLE')]] } },
      config: defaultConfig({ provider: 'fixture', model: 'fixture' }), turn: 0,
      advance: { profileId: 'profile', content: marked('PRIOR'), tags: {} } },
    card: { name: '资料馆', description: marked('CARD') },
    worldbook: [...book('Bound', 'card'), ...book('Atlas', 'atlas-resource'), ...book('Ledger', 'ledger-resource')],
    text: marked('INPUT'), emit() {}, trace: [], mapConcurrent,
    data: { contextTurnCount: 1, ...profile, plotTasks: [{ id: 'inspect', name: 'inspect', extractTags: 'result',
      promptGroup: [{ role: 'SYSTEM', content: 'LITERAL <task>KEEP_TEMPLATE</task>' }, { role: 'USER', content: prompt },
        { role: 'assistant', content: 'LITERAL_TAIL' }, { role: 'user', enabled: false, content: 'DISABLED_PROMPT' }], ...task }] },
  };
}
async function capture(label, args) {
  const requests = [], before = structuredClone({ data: args.data, worldbook: args.worldbook, advanceWorldbooks: args.advanceWorldbooks, card: args.card, tables: args.state.tables });
  const result = await runAdvancePreset({ ...args, callModel: async options => {
    const output = { sections: Object.fromEntries(options.schema.properties.sections.required.map(name => [name, 'Fixture result.'])) };
    const request = { case: label, label: options.label, messages: structuredClone(options.messages), schema: options.schema, output };
    requests.push(request); captures.push(request);
    return output;
  } });
  assert.deepEqual({ data: args.data, worldbook: args.worldbook, advanceWorldbooks: args.advanceWorldbooks, card: args.card, tables: args.state.tables }, before);
  for (const request of requests) {
    assert.equal(request.messages[0].content, 'LITERAL <task>KEEP_TEMPLATE</task>');
    assert.ok(request.messages.some(message => message.role === 'assistant' && message.content === 'LITERAL_TAIL'));
    assert.ok(!JSON.stringify(request.messages).includes('DISABLED_PROMPT'));
  }
  return { requests, result };
}
function field(request, name) {
  const text = expandedMessages(request.messages).find(message => message.role === 'user').content;
  const start = text.indexOf(`<${name}>`) + name.length + 2;
  return text.slice(start, text.indexOf(`</${name}>`, start));
}
function books(request) { return field(request, 'books').split('\n\n').filter(Boolean).sort(); }
const enabled = (...names) => names.flatMap(name => [`${name}_ZERO`, `${name}_ONE`]).sort();

for (const [label, profile, task, expected] of [
  ['profile zero', 0, {}, []],
  ['task zero overrides profile', 2, { contextTurnCount: 0 }, []],
  ['task positive overrides profile zero', 0, { contextTurnCount: 1 }, ['LATEST']],
  ['task expands profile history', 1, { contextTurnCount: 2 }, ['EARLIER', 'LATEST']],
  ['missing task count inherits', 2, {}, ['EARLIER', 'LATEST']],
  ['undefined task count inherits', 2, { contextTurnCount: undefined }, ['EARLIER', 'LATEST']],
]) test(`C2 context: ${label}`, async t => {
  const { requests } = await capture(t.name, fixture({ contextTurnCount: profile }, task));
  const history = field(requests[0], 'history');
  assert.equal(history, expected.map(marked).join('\n\n'));
  assert.ok(!history.includes('PAST_USER')); assert.ok(!history.includes('HIDDEN'));
});

test('C2 task exclusions override profile only for injected placeholders', async t => {
  const args = fixture({ contextExcludeRules: rule('profile') }, { contextExcludeRules: rule('task') });
  args.worldbook = normalizeWorldbook({ name: 'Bound', entries: [{ uid: 0, content: marked('BOOK'), constant: true }] });
  const { requests } = await capture(t.name, args);
  for (const name of ['books', 'tables', 'prior', 'history', 'input', 'persona', 'card']) {
    assert.ok(field(requests[0], name).includes('PROFILE_'), name);
    assert.ok(!field(requests[0], name).includes('TASK_'), name);
  }
});

test('C2 explicit empty task exclusions clear inherited rules', async t => {
  const { requests } = await capture(t.name, fixture({ contextExcludeRules: rule('profile') }, { contextExcludeRules: [] }));
  assert.equal(field(requests[0], 'input'), marked('INPUT'));
});

test('C2 omitted task filters inherit profile with plotSettings wrapper', async t => {
  const args = fixture({ contextExcludeRules: rule('profile') });
  args.data = { plotSettings: args.data };
  const { requests } = await capture(t.name, args);
  assert.equal(field(requests[0], 'input'), 'INPUT<task>TASK_INPUT</task>');
  assert.equal(field(requests[0], 'history'), 'LATEST<task>TASK_LATEST</task>');
});

test('C2 task extraction overrides profile for history only', async t => {
  const { requests } = await capture(t.name, fixture({ contextExtractRules: rule('profile') }, { contextExtractRules: rule('task') }));
  assert.equal(field(requests[0], 'history'), '<task>TASK_LATEST</task>');
  assert.equal(field(requests[0], 'input'), marked('INPUT'));
});

test('C2 task legacy extract and exclude tags are consumed', async t => {
  const { requests } = await capture(t.name, fixture({ contextExtractTags: 'profile', contextExcludeTags: 'profile' },
    { contextExtractTags: 'task', contextExcludeTags: 'task' }));
  assert.equal(field(requests[0], 'history'), '');
  assert.equal(field(requests[0], 'input'), 'INPUT<profile>PROFILE_INPUT</profile>');
});

test('C2 final directive retains profile filters after tasks override them', async t => {
  const args = fixture({ contextExcludeRules: rule('profile'), finalSystemDirective: 'DIRECTIVE $8' }, { contextExcludeRules: rule('task') });
  const { result } = await capture(t.name, args);
  assert.ok(result.injection.startsWith('DIRECTIVE INPUT<task>TASK_INPUT</task>'));
});

for (const [label, profile, task, expected] of [
  ['flat manual book names', { worldbookSource: 'manual', selectedWorldbooks: ['Atlas'] }, {}, enabled('Atlas')],
  ['nested source and selection precede flat fields', { worldbookSource: 'character', selectedWorldbooks: ['Ledger'],
    plotWorldbookConfig: { source: 'manual', manualSelection: ['Atlas'] } }, {}, enabled('Atlas')],
  ['nested character precedes flat manual', { worldbookSource: 'manual', selectedWorldbooks: ['Atlas'],
    plotWorldbookConfig: { source: 'character' } }, {}, enabled('Bound')],
  ['explicit empty manual selection', { worldbookSource: 'manual', selectedWorldbooks: ['Atlas'],
    plotWorldbookConfig: { source: 'manual', manualSelection: [] } }, {}, []],
  ['nested omitted selection inherits flat selection', { selectedWorldbooks: ['Atlas'], plotWorldbookConfig: { source: 'manual' } }, {}, enabled('Atlas')],
  ['entry empty list excludes only configured book', { plotWorldbookConfig: { source: 'manual', manualSelection: ['Atlas', 'Ledger'], enabledEntries: { Atlas: [] } } }, {}, enabled('Ledger')],
  ['entry UID selection is scoped by book', { plotWorldbookConfig: { source: 'manual', manualSelection: ['Atlas', 'Ledger'], enabledEntries: { Atlas: [1], Ledger: [0] } } }, {}, ['Atlas_ONE', 'Ledger_ZERO']],
  ['omitted source preserves prepared worldbooks', {}, {}, enabled('Bound', 'Atlas', 'Ledger')],
  ['empty entry map keeps enabled entries', { plotWorldbookConfig: { source: 'character', enabledEntries: {} } }, {}, enabled('Bound')],
  ['missing entry map keeps enabled entries', { worldbookSource: 'character' }, {}, enabled('Bound')],
  ['all-selected sentinel keeps enabled entries', { worldbookSource: 'character', disabledWorldbookEntries: '__ALL_SELECTED__' }, {}, enabled('Bound')],
  ['per-book all-selected sentinel keeps entries', { plotWorldbookConfig: { source: 'character', enabledEntries: { Bound: '__ALL_SELECTED__' } } }, {}, enabled('Bound')],
  ['task nested source overrides profile config', { plotWorldbookConfig: { source: 'character' } },
    { plotWorldbookConfig: { source: 'manual', manualSelection: ['Ledger'], enabledEntries: { Ledger: [0] } } }, ['Ledger_ZERO']],
  ['task worldbook enable overrides profile false', { worldbookEnabled: false, worldbookSource: 'character' }, { worldbookEnabled: true }, enabled('Bound')],
  ['task worldbook disable overrides profile true', { worldbookEnabled: true }, { worldbookEnabled: false }, []],
  ['normalized disabled UID', { worldbookSource: 'character', disabledWorldbookEntries: ['card:0'] }, {}, ['Bound_ONE']],
  ['original disabled UID', { worldbookSource: 'character', disabledWorldbookEntries: ['1'] }, {}, ['Bound_ZERO']],
  ['disabled entry stays disabled even when selected', { plotWorldbookConfig: { source: 'character', enabledEntries: { Bound: [2] } } }, {}, []],
]) test(`C3 worldbook: ${label}`, async t => {
  const { requests } = await capture(t.name, fixture(profile, task));
  assert.deepEqual(books(requests[0]), expected);
});

test('Disabled tasks do not produce a request', async t => {
  const { requests, result } = await capture(t.name, fixture({}, { enabled: false }));
  assert.equal(requests.length, 0); assert.deepEqual(result.results, []);
});

test('Three local rounds keep task context and filters isolated while inheriting omitted fields', async t => {
  const args = fixture({ contextTurnCount: 2, contextExcludeRules: rule('profile') }, { contextTurnCount: 0, contextExcludeRules: rule('task') });
  args.data.plotTasks.push({ ...args.data.plotTasks[0], id: 'inherit', name: 'inherit', contextTurnCount: undefined, contextExcludeRules: undefined });
  const history = ['EARLIER', 'LATEST'];
  for (let round = 0; round < 3; round++) {
    if (round) {
      const value = `ROUND_${round + 1}`; history.push(value);
      args.state.messages.push({ role: 'assistant', content: marked(value) });
    }
    args.state.turn = round; args.data.plotTasks[0].contextTurnCount = round;
    const { requests } = await capture(`${t.name}: ${round + 1}`, args);
    assert.equal(requests.length, 2);
    const own = requests.find(request => request.label === 'inspect'), inherited = requests.find(request => request.label === 'inherit');
    assert.equal(field(own, 'history'), history.slice(-round || Infinity).map(value => `${value}<profile>PROFILE_${value}</profile>`).join('\n\n'));
    assert.equal(field(inherited, 'history'), history.slice(-2).map(value => `${value}<task>TASK_${value}</task>`).join('\n\n'));
    assert.equal(field(own, 'input'), 'INPUT<profile>PROFILE_INPUT</profile>');
    assert.equal(field(inherited, 'input'), 'INPUT<task>TASK_INPUT</task>');
    if (round) assert.ok(field(own, 'prior').includes('<result>Fixture result.</result>'));
  }
});

test('Three local rounds select directory books by name or id without reusing prior sources', async t => {
  const args = fixture();
  const remote = (id, name) => ({ id, name, source: 'manual', entries: normalizeWorldbook({ name, entries: [
    { uid: 0, constant: true, content: `${name}_ZERO` }, { uid: 1, constant: true, content: `${name}_ONE` },
    { uid: 2, constant: true, content: `${name}_DISABLED`, disable: true },
  ] }, id) });
  args.advanceWorldbooks = [remote('remote-key', 'Remote'), remote('other-key', 'RemoteOther'),
    { id: 'empty-key', name: 'Empty', source: 'manual', entries: [] },
    { id: 'bound-key', name: 'Bound', source: 'character', entries: args.worldbook.filter(entry => entry.id.startsWith('card:')) }];
  args.data.plotTasks.push({ ...args.data.plotTasks[0], id: 'bound', name: 'bound', plotWorldbookConfig: { source: 'character' } });
  const rounds = [['Remote', ['Remote_ZERO']], ['other-key', ['RemoteOther_ONE']], ['Empty', []]];
  for (const [selection, expected] of rounds) {
    args.data.plotTasks[0].plotWorldbookConfig = { source: 'manual', manualSelection: [selection], enabledEntries: { Remote: [0, 2], RemoteOther: [1] } };
    const { requests } = await capture(`${t.name}: ${selection}`, args);
    assert.deepEqual(books(requests.find(request => request.label === 'inspect')), expected);
    assert.deepEqual(books(requests.find(request => request.label === 'bound')), enabled('Bound'));
    args.state.turn++;
  }
});

after(async () => {
  if (process.env.ADVANCE_CONFIG_CAPTURE) await writeFile(process.env.ADVANCE_CONFIG_CAPTURE, JSON.stringify(captures, null, 2) + '\n');
});
