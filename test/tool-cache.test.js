import test from 'node:test';
import assert from 'node:assert/strict';
import { runAdvancePreset } from '../src/advance.js';
import { defaultConfig } from '../src/contracts.js';
import { normalizeWorldbook } from '../src/worldbook.js';
import { makeModelCaller } from '../src/model.js';
import { evidenceSourceView, tableTemplateView, orderedToolInput, toolWorldbook } from '../src/tool-context.js';
import { evidenceSources } from '../src/memory.js';
import { expandedMessages, sourcePassages } from './helpers/tool-context.js';

test('advance keeps literal instructions and permanent lore before changing substitutions in every role', async () => {
  const requests = [];
  for (const turn of [1, 2]) await runAdvancePreset({
    state: { turn, userName: '访客', messages: [{ role: 'assistant', content: `HISTORY_${turn}` }], tables: {}, config: defaultConfig() },
    card: { name: '场景' }, text: `INPUT_${turn}`, emit() {}, trace: [],
    worldbook: normalizeWorldbook({ entries: [
      { id: 1, constant: true, content: `DYNAMIC_${turn}`, cacheStatic: false, extensions: { group: 'changing' } },
      { id: 2, constant: true, content: 'PERMANENT_LORE' },
    ] }),
    data: { plotTasks: [{ name: '推进', extractTags: 'plan', promptGroup: [
      { role: 'system', content: 'FIXED_HEAD' },
      { role: 'user', content: '<books>$1</books><history>$7</history><input>$8</input>' },
      { role: 'assistant', content: 'FIXED_ASSISTANT' },
      { role: 'user', content: 'FIXED_TAIL $8' },
    ] }] },
    callModel: async request => { requests.push(request); return { sections: { plan: '下一步行动。' } }; },
  });
  const first = requests[0].messages, second = requests[1].messages;
  const boundary = first.findIndex(message => message.content.includes('DYNAMIC_1'));
  assert.ok(boundary > 0);
  assert.deepEqual(first.slice(0, boundary), second.slice(0, boundary));
  const prefix = JSON.stringify(first.slice(0, boundary));
  for (const text of ['FIXED_HEAD', 'FIXED_ASSISTANT', 'FIXED_TAIL', 'PERMANENT_LORE']) assert.ok(prefix.includes(text));
  for (const text of ['INPUT_1', 'HISTORY_1', 'DYNAMIC_1']) assert.equal(JSON.stringify(first).split(text).length - 1, 1);
  assert.ok(expandedMessages(first).some(message => message.content === '<books>PERMANENT_LORE\n\nDYNAMIC_1</books><history>HISTORY_1</history><input>INPUT_1</input>'));
});

test('evidence grouping preserves every quote, evidence id and message owner without per-line UUID copies', () => {
  const messages = [{ id: 'user-uuid', content: '提出建议\n保持标点！' }, { id: 'story-uuid', content: '已完成正文\n保留　空格与引号“”。' }];
  const original = evidenceSources(messages), sourceView = evidenceSourceView(original);
  assert.deepEqual(sourcePassages({ sourcePassages: sourceView }), original);
  for (const message of messages) assert.equal(JSON.stringify(sourceView).split(message.id).length - 1, 1);
});

test('executable presets keep substitution evaluation order and cannot enter the fixed prefix', async () => {
  await runAdvancePreset({ state: { turn: 0, userName: '访客', variables: { phase: 'BEFORE_SCRIPT' }, messages: [], tables: {}, config: defaultConfig() },
    card: { name: '场景' }, text: '{{getvar::phase}}', worldbook: [], emit() {}, trace: [],
    data: { plotTasks: [{ name: '脚本', extractTags: 'plan', promptGroup: [
      { role: 'user', content: 'INPUT $8' },
      { role: 'user', content: '<% setvar("phase", "AFTER_SCRIPT") %>SCRIPT_OUTPUT' },
      { role: 'system', content: 'FIXED_RULE' },
    ] }] },
    callModel: async ({ messages }) => {
      assert.equal(messages[0].content, 'FIXED_RULE');
      assert.ok(messages.some(message => message.content === 'INPUT BEFORE_SCRIPT'));
      assert.ok(messages.findIndex(message => message.content === 'SCRIPT_OUTPUT') > 0);
      assert.doesNotMatch(JSON.stringify(messages), /tavern-context/);
      return { sections: { plan: '完成。' } };
    },
  });
});

test('table tool view retains initialization and SQL constraints while dropping export settings', () => {
  const template = { id: 'sheet_1', uid: 'duplicate-id', name: '角色', sqlName: 'actors', keyColumn: 'id', headers: ['编号'], columns: [{ cid: 0, name: 'id', type: 'INTEGER', pk: 1, notnull: 1, dflt_value: null }], instructions: { initNode: '首次初始化规则', updateNode: '更新规则', ddl: 'CREATE TABLE actors(id INTEGER PRIMARY KEY)' }, updateConfig: {}, exportConfig: { injectionTemplate: 'EXPORT_ONLY' } };
  const view = tableTemplateView(template);
  assert.deepEqual(view.instructions, template.instructions);
  assert.deepEqual(view.columns[0], { name: 'id', type: 'INTEGER', pk: 1, notnull: 1, dflt_value: null });
  assert.ok(!JSON.stringify(view).includes('EXPORT_ONLY'));
  const books = normalizeWorldbook({ entries: [{ id: 1, constant: true, content: 'FIXED' }, { id: 2, keys: ['条件'], content: 'ACTIVATED' }] });
  const input = orderedToolInput({ worldbookDirectory: ['CHANGING_DIRECTORY'], userInput: 'CURRENT', characters: ['IDENTITIES'], ...toolWorldbook(books), templates: [view] });
  assert.ok(JSON.stringify(input).indexOf('FIXED') < JSON.stringify(input).indexOf('CHANGING_DIRECTORY'));
  assert.ok(JSON.stringify(input).indexOf('IDENTITIES') < JSON.stringify(input).indexOf('ACTIVATED'));
});

test('protocol retries append corrections after the unchanged original request and schema', async () => {
  const requests = [];
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
  const call = makeModelCaller({ stream: async function* (options) {
    requests.push(options);
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', name: 'tavern_result', arguments: requests.length === 1 ? '{}' : '{"ok":true}' } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } });
  await call({ agent: { provider: 'fixture', model: 'fixture' }, schema, retries: 1,
    messages: [{ role: 'system', content: 'FIXED_RULE' }, { role: 'user', content: 'CURRENT_INPUT' }] });
  const text = message => message.content.map(block => block.text ?? '').join('');
  assert.match(text(requests[0].messages[0]), /结构化任务/);
  assert.deepEqual(requests[1].messages.slice(0, -1).map(text), requests[0].messages.map(text));
  assert.match(text(requests[1].messages.at(-1)), /上次结果未通过/);
  assert.deepEqual(requests[0].tools, requests[1].tools);
});
