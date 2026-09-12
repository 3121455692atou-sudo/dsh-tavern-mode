import test from 'node:test';
import assert from 'node:assert/strict';
import { runAdvancePreset } from '../src/advance.js';
import { defaultConfig } from '../src/contracts.js';
import { makeModelCaller } from '../src/model.js';

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
  await assert.rejects(runAdvancePreset({ ...fixture({ extractTags: 'index' }), callModel: async () => ({ sections: { index: '' } }) }), /fewer than 1/);
});

test('Advance task context zero excludes history and missing task minimum inherits the profile', async () => {
  await runAdvancePreset({ ...fixture({}, { contextTurnCount: 0 }), callModel: async ({ messages }) => {
    assert.doesNotMatch(JSON.stringify(messages), /先前已完成登记/);
    assert.match(JSON.stringify(messages), /查看登记记录/);
    return { sections: { recall: '足够完整的查询结果内容' }, selectedRecords: [] };
  } });
  await assert.rejects(runAdvancePreset({ ...fixture({ minLength: undefined }, { minLength: 100 }), callModel: async () => ({ sections: { recall: 'ABCDEF' }, selectedRecords: [] }) }), /内容长度不足/);
});

test('Three configured correction retries reach a valid fourth response and report each rejection', async () => {
  const requests = [], attempts = [];
  const call = makeModelCaller({ async *stream(options) {
    requests.push(options);
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', name: 'tavern_result', arguments: JSON.stringify(requests.length < 4 ? { wrong: requests.length } : { sections: { recall: 'AM0001' }, selectedRecords: [] }) } };
    yield { type: 'finish', reason: { kind: 'tool-calls' } };
  } });
  const args = fixture({ maxRetries: 1 });
  assert.equal(args.state.config.protocolRetries, 3);
  const result = await runAdvancePreset({ ...args, callModel: options => call({ ...options, onAttempt: record => attempts.push(record) }) });
  assert.equal(result.results[0].content, '<recall>AM0001</recall>');
  assert.equal(requests.length, 4);
  assert.equal(attempts.length, 4);
  assert.deepEqual(attempts.map(a => a.status), ['retrying', 'retrying', 'retrying', 'succeeded']);
  assert.deepEqual(attempts.map(a => a.attempt), [1, 2, 3, 4]);
  assert.equal(JSON.parse(attempts[0].response.toolCalls[0].arguments).wrong, 1);
  assert.match(JSON.stringify(requests[1].messages), /上次结果未通过协议校验/);
});
