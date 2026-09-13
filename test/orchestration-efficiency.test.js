import test from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/pipeline.js';
import { defaultConfig } from '../src/contracts.js';
import { makeModelCaller } from '../src/model.js';
import { currentFacts } from '../src/memory.js';
const scene = { location: '公共图书馆', time: '下午', summary: '成年读者归还书籍。' };
const story = '林岚把归还日期告诉周川。\n周川确认周五还书。';
const card = { name: '图书馆', description: '两位成年读者。', character_book: { entries: [{ id: 1, comment: '图书馆规则', constant: true, enabled: true, content: 'CANON_COMPLETE: 图书馆周五提前闭馆；借书卡不可转借。'.repeat(80) }] } };
const legacy = { plotTasks: [
  { name: '纪要召回', extractTags: 'recall', promptGroup: [{ role: 'system', content: '只召回已有纪要。' }, { role: 'user', content: 'INDEX $5\nHISTORY $7\nINPUT $8' }] },
  { name: '固定规则', extractTags: 'world_rules', promptGroup: [{ role: 'system', content: '确认规则：借书卡不可转借；开放时间由馆方公布。' }] },
  { name: '推进', extractTags: 'tabletop', promptGroup: [{ role: 'system', content: '依据既有信息规划，不替用户决定。' }, { role: 'user', content: '<books>$1</books>\n<history>$7</history>\n<input>$8</input>\n{{world_rules}}\n{{recall}}' }] },
] };
const toolPreset = { settings: {}, prompts: [
  { enabled: true, role: 'user', content: 'UNSCOPED_PROSE_CONFLICT: 只输出散文，不输出JSON。'.repeat(100) },
  { enabled: true, role: 'system', content: 'TABLE_SCOPED_RULE', toolStages: ['table'] },
] };
const initial = () => ({ id: 'neutral-3turn', turn: 1, legacyId: 'neutral', config: defaultConfig({ provider: 'fixture', model: 'fixture' }), userName: '访客', scene,
  messages: [{ id: 'old-story', role: 'assistant', content: '两位成年读者各自整理书单。' }], tables: {}, variables: {}, worldHistory: [], renderMode: 'text',
  characters: [{ id: 'a', name: '林岚', profile: '成年读者。' }, { id: 'b', name: '周川', profile: '成年读者。' }],
  memories: Object.fromEntries(['a','b'].map(id => [id, [{ id: id+'-only', summary: id.toUpperCase()+'_SECRET：私下计划。', facts: [], relationships: [], openThreads: [] }]])),
});
function responder({ requests, attempts, fault = 'repair' }) {
  let missingPlan = fault === 'repair';
  return async request => {
    requests.push(request);
    if (process.env.VERIFY_TRACE) console.log('stage', request.stage, request.label);
    const raw = request.messages.map(m => { try { return JSON.parse(m.content); } catch { return null; } }).find(v => v?.character || v?.characters || v?.planningContext) ?? {};
    const text = JSON.stringify(request.messages);
    if (request.schema) assert.ok(!text.includes('UNSCOPED_PROSE_CONFLICT'));
    if (request.stage !== 'table') assert.ok(!text.includes('TABLE_SCOPED_RULE'));
    let streamIndex = 0;
    const call = makeModelCaller({ stream: async function* (options) {
      streamIndex++;
      const base = { scene, beats: ['说明期限，等候用户回应。'], characterIntents: [{ characterId: 'a', intent: '说明期限。', knowledgeBoundary: '不知道周川私下计划。' }], constraints: ['不替用户行动。'] };
      let out;
      if (request.stage === 'recall') {
        assert.ok(!text.includes(raw.character.id === 'a' ? 'B_SECRET' : 'A_SECRET'));
        assert.ok(!Object.hasOwn(raw, 'worldbook'));
        out = { characterId: raw.character.id, memories: [], perspective: '依据本人经历。', likelyPresent: raw.character.id === 'a' };
      } else if (request.stage === 'combine') {
        assert.ok(raw.worldbookDirectory.length); assert.ok(!Object.hasOwn(raw, 'activeWorldbook'));
        out = { scene, presentCharacterIds: ['a'], worldEntryIds: ['card:1'], situation: '归还图书', characterViews: [], openThreads: [] };
      } else if (request.stage === 'advance') {
        if (request.schema.properties.sections?.properties.recall) out = { sections: { recall: '' }, selectedRecords: [] };
        else if (request.schema.properties.sections?.properties.world_rules) {
          assert.ok(!text.includes('summaryRecords')); out = { sections: { world_rules: '借书卡不可转借。' } };
        } else {
          out = { sections: { tabletop: '让林岚解释期限，让周川确认听到的信息。' } };
          assert.ok(!request.schema.properties.plan);
          assert.ok(!text.includes('planningContext'));
          if (fault === 'refusal') { yield { type: 'text-delta', text: '无法处理这项请求。' }; yield { type: 'finish', reason: { kind: 'stop' } }; return; }
          if (missingPlan) { out.sections.tabletop = 7; missingPlan = false; }
          if (streamIndex > 1) { assert.ok(!JSON.stringify(options.messages).includes('CANON_COMPLETE')); assert.ok(JSON.stringify(options.messages).includes('candidate')); }
        }
      } else if (request.stage === 'write') {
        assert.ok(text.includes('CANON_COMPLETE')); yield { type: 'text-delta', text: story };
        yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, totalTokens: 110 } }; yield { type: 'finish', reason: { kind: 'stop' } }; return;
      } else if (request.stage === 'memory') {
        const passage = raw.sourcePassages.find(s => s.messageId === raw.completedStoryMessageId).passages.at(-1);
        out = { events: [{ summary: '周川确认周五还书。', knownByCharacterIds: ['a', 'b'], evidence: { sourceId: passage.id } }],
          characters: raw.characters.map(character => {
            const previous = raw.characterStates.find(c => c.characterId === character.id).currentState.find(x => x.key === '归还日期');
            return { characterId: character.id, stateChanges: [{ op: 'set', target: previous ? { id: previous.id } : { subject: character.name, key: '归还日期' }, value: '周五', evidence: { sourceId: passage.id } }] };
          }) };
      } else if (request.stage === 'table') {
        assert.ok(text.includes('TABLE_SCOPED_RULE'));
        const passage = raw.sourcePassages.find(s => s.messageId === raw.completedStoryMessageId).passages.at(-1);
        out = { scene, operations: [], worldChanges: [], participatingCharacters: ['a', 'b'].map(characterId => ({ characterId, evidence: { sourceId: fault === 'evidence' ? 'fake-source' : passage.id } })), newCharacters: [] };
      } else throw new Error('Unexpected stage ' + request.stage);
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', name: 'tavern_result', arguments: JSON.stringify(out) } };
      yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, totalTokens: 110 } }; yield { type: 'finish', reason: { kind: 'stop' } };
    } });
    return call({ ...request, onAttempt: value => attempts.push({ stage: request.stage, label: request.label, ...value }) });
  };
}
test('three turns retain writer prose, private memory, actual participants and bounded repair', async () => {
  const input = initial(), snapshot = structuredClone(input), requests = [], attempts = [];
  const callModel = responder({ requests, attempts }); let state = input;
  for (let i = 0; i < 3; i++) {
    state = await runTurn({ state, card, legacy, toolPreset, text: `第${i + 1}轮：说明归还日期。`, callModel });
    assert.equal(state.messages.at(-1).content, story);
    for (const id of ['a', 'b']) { assert.equal(state.memories[id].length, i + 2); assert.equal(currentFacts(state.memories[id]).at(-1).value, '周五'); }
    assert.ok(state.lastRun.trace.every(record => record.requests.length >= 1));
  }
  assert.deepEqual(input, snapshot);
  assert.equal(requests.filter(r => r.stage === 'write').length, 3);
  assert.equal(requests.filter(r => r.stage === 'combine').length, 0);
  assert.equal(requests.filter(r => r.stage === 'memory').length, 3);
  assert.equal(attempts.filter(a => a.kind === 'normalized').length, 0);
  assert.equal(attempts.filter(a => a.status === 'retrying').length, 1);
  assert.equal(attempts.length, requests.length + 1);
  const rules = requests.filter(r => r.label === '固定规则'); assert.deepEqual(rules[0].messages, rules[2].messages);
});
test('refusal stops one large stage; no writer or state commit', async () => {
  const state = initial(), before = structuredClone(state), requests = [], attempts = [];
  await assert.rejects(runTurn({ state, card, legacy, toolPreset, text: '说明期限。', callModel: responder({ requests, attempts, fault: 'refusal' }) }), /结构化结果/);
  assert.equal(attempts.filter(a => a.label === '推进').length, 1);
  assert.ok(!requests.some(r => r.stage === 'write')); assert.deepEqual(state, before);
});
