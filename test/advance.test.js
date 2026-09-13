import test from 'node:test';
import assert from 'node:assert/strict';
import { runAdvancePreset } from '../src/advance.js';
import { PLAN, defaultConfig, ProtocolError } from '../src/contracts.js';
import { makeModelCaller } from '../src/model.js';
import { normalizeWorldbook } from '../src/worldbook.js';

function fixture(task = {}, profile = {}) {
  return {
    state: { id: 'fixture', legacyId: 'preset', userName: '访客', messages: [{ role: 'assistant', content: '先前已完成登记。' }], tables: {}, config: defaultConfig({ provider: 'fixture', model: 'fixture' }), turn: 0 },
    card: { name: '图书馆' }, worldbook: [], text: '查看登记记录', emit() {}, trace: [],
    data: { ...profile, plotTasks: [{ id: 'lookup', name: '索引', extractTags: 'recall', minLength: 10, maxRetries: 1000, promptGroup: [{ role: 'USER', content: '$7\n本轮：$8' }], ...task }] },
    mapConcurrent: (items, limit, fn) => Promise.all(items.map(fn)),
  };
}

test('Imported minimum length measures reconstructed tagged output, not the shorter section value', async () => {
  for (const tag of ['recall', 'index']) {
    const result = await runAdvancePreset({ ...fixture({ extractTags: tag }), callModel: async () => ({ sections: { [tag]: 'AM0001' }, ...(tag === 'recall' ? { selectedRecords: [] } : {}) }) });
    assert.equal(result.results[0].content, `<${tag}>AM0001</${tag}>`);
  }
  await assert.rejects(runAdvancePreset({ ...fixture({ extractTags: '' }), callModel: async () => ({ content: 'ABCDEF' }) }), /内容长度不足/);
  await assert.rejects(runAdvancePreset({ ...fixture({ extractTags: 'index' }), callModel: async () => ({ sections: { index: '' } }) }), error => error instanceof ProtocolError && error.issues?.some(issue => issue.keyword === 'minLength' && issue.instancePath === '/sections/index'));
});

test('Summary selection receives the directory while the subsequent plot task keeps full activated lore', async () => {
  const args = fixture({ promptGroup: [{ role: 'USER', content: '$1\n$5\n$7\n$8' }] });
  args.worldbook = normalizeWorldbook({ entries: [{ id: 1, constant: true, keys: ['登记'], comment: '登记处<!-- editor metadata -->', content: 'FULL_WORLD_DETAIL' }] });
  args.data.plotTasks.push({ id: 'plot', name: '推进', extractTags: 'plot', promptGroup: [{ role: 'USER', content: '$1' }] });
  await runAdvancePreset({ ...args, callModel: async ({ label, messages }) => {
    const input = JSON.stringify(messages);
    if (label === '索引') {
      assert.match(input, /card:1/); assert.match(input, /登记处/);
      assert.match(input, /先前已完成登记/); assert.match(input, /查看登记记录/);
      assert.doesNotMatch(input, /FULL_WORLD_DETAIL|editor metadata/);
      return { sections: { recall: '' }, selectedRecords: [] };
    }
    assert.match(input, /FULL_WORLD_DETAIL/);
    return { sections: { plot: '下一步查询登记档案。' } };
  } });
});

test('Final plot task returns a validated plan without changing the writer injection or duplicating lore', async () => {
  const args = fixture({ extractTags: 'plot', promptGroup: [{ role: 'USER', content: '$1\n$8' }] });
  args.worldbook = normalizeWorldbook({ entries: [{ id: 1, constant: true, keys: [], content: 'UNIQUE_WORLD_DETAIL' }] });
  const section = { sections: { plot: '下一步查询登记档案。' } };
  const expected = await runAdvancePreset({ ...args, state: structuredClone(args.state), callModel: async () => section });
  const plan = { scene: { location: '登记处', time: '上午', summary: '查询档案。' }, beats: ['查阅目录'], characterIntents: [], constraints: [] };
  const planRequest = { schema: PLAN, input: { userInput: args.text }, worldbook: args.worldbook, instruction: '填写计划。', validate(value) { assert.deepEqual(value, plan); } };
  let calls = 0;
  const result = await runAdvancePreset({ ...args, planRequest, callModel: async ({ messages, schema }) => {
    calls++;
    assert.ok(schema.required.includes('plan'));
    assert.equal(JSON.stringify(messages).split('UNIQUE_WORLD_DETAIL').length - 1, 1);
    return { ...section, plan };
  } });
  assert.equal(calls, 1); assert.deepEqual(result.plan, plan);
  assert.deepEqual(result.results, expected.results);
  assert.equal(result.injection, expected.injection);
  assert.equal(result.injection, '<plot>下一步查询登记档案。</plot>');
  assert.deepEqual(result.results[0].sections, section.sections);
  assert.ok(!result.results[0].content.includes('characterIntents'));
  await assert.rejects(runAdvancePreset({ ...args, planRequest, callModel: async () => section }), /plan/);
  await assert.rejects(runAdvancePreset({ ...args, planRequest, callModel: async () => ({ ...section, plan: {} }) }), /scene/);
  let separate = false;
  await runAdvancePreset({ ...args, planRequest: { ...planRequest, worldbook: [{ id: 'excluded', content: 'EXCLUDED_WORLD' }] }, callModel: async ({ schema, messages }) => {
    separate = !schema.properties.plan;
    assert.doesNotMatch(JSON.stringify(messages), /EXCLUDED_WORLD/);
    return section;
  } });
  assert.ok(separate, 'excluded planner sources keep the ordinary planner separate');
  const selected = normalizeWorldbook({ entries: [{ id: 2, keys: ['未提及的人物'], content: 'COMBINATION_SELECTED_DETAIL' }] });
  await runAdvancePreset({ ...args, worldbook: [...args.worldbook, ...selected], planRequest: { ...planRequest, worldbook: [...args.worldbook, ...selected] }, callModel: async ({ messages, schema }) => {
    assert.ok(schema.properties.plan);
    assert.equal(JSON.stringify(messages).split('COMBINATION_SELECTED_DETAIL').length - 1, 1);
    return { ...section, plan };
  } });
});

test('Advance task context zero excludes history and missing task minimum inherits the profile', async () => {
  await runAdvancePreset({ ...fixture({}, { contextTurnCount: 0 }), callModel: async ({ messages }) => {
    assert.doesNotMatch(JSON.stringify(messages), /先前已完成登记/);
    assert.match(JSON.stringify(messages), /查看登记记录/);
    return { sections: { recall: '足够完整的查询结果内容' }, selectedRecords: [] };
  } });
  await assert.rejects(runAdvancePreset({ ...fixture({ minLength: undefined }, { minLength: 100 }), callModel: async () => ({ sections: { recall: 'ABCDEF' }, selectedRecords: [] }) }), /内容长度不足/);
});

test('Legacy retry setting permits only one compact repair and records both attempts', async () => {
  const requests = [], attempts = [];
  const call = makeModelCaller({ async *stream(options) {
    requests.push(options);
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', name: 'tavern_result', arguments: JSON.stringify(requests.length < 2 ? { wrong: requests.length } : { sections: { recall: 'AM0001' }, selectedRecords: [] }) } };
    yield { type: 'finish', reason: { kind: 'tool-calls' } };
  } });
  const args = fixture({ maxRetries: 1 });
  assert.equal(args.state.config.protocolRetries, 3);
  const result = await runAdvancePreset({ ...args, callModel: options => call({ ...options, onAttempt: record => attempts.push(record) }) });
  assert.equal(result.results[0].content, '<recall>AM0001</recall>');
  assert.equal(requests.length, 2);
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts.map(a => a.status), ['retrying', 'succeeded']);
  assert.deepEqual(attempts.map(a => a.attempt), [1, 2]);
  assert.equal(JSON.parse(attempts[0].response.toolCalls[0].arguments).wrong, 1);
  assert.match(JSON.stringify(requests[1].messages), /candidate/);
});
