import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig } from '../src/contracts.js';
import { runTurn } from '../src/pipeline.js';
import { runAdvancePreset } from '../src/advance.js';

const scene = { location: '图书馆', time: '上午', summary: '' };

test('Normal play mode writes from the card and worldbook and skips agent stages', async () => {
  const stages = [];
  let writing = '';
  const config = defaultConfig({ provider: 'fixture', model: 'fixture' });
  config.playMode = 'normal';
  const state = { id: 'normal', cardId: 'card', userName: '访客', config, characters: [], memories: {}, messages: [], tables: {}, variables: {}, scene, renderMode: 'text' };
  const result = await runTurn({
    state,
    card: { name: '馆员', description: '图书馆管理员。', character_book: { entries: [{ uid: 1, constant: true, content: 'WORLD_CONSTANT', position: 0 }] } },
    text: '你好。',
    callModel: async ({ stage, schema, messages }) => {
      stages.push(stage);
      if (schema) throw new Error('普通模式不应调用结构化 agent：' + stage);
      writing = JSON.stringify(messages);
      return '欢迎光临。';
    },
  });
  assert.deepEqual(stages, ['write']);
  assert.match(writing, /WORLD_CONSTANT/);
  assert.match(writing, /图书馆管理员/);
  assert.equal(result.messages.at(-2).content, '你好。');
  assert.equal(result.messages.at(-1).content, '欢迎光临。');
  assert.equal(result.worldHistory, undefined);
  assert.ok(!JSON.stringify(result.lastRun.trace).includes('combine'));
});

test('Same-stage advance tasks run in order so later prompts see earlier tags', async () => {
  const seen = [];
  const result = await runAdvancePreset({
    state: { id: 'seq', legacyId: 'preset', userName: '访客', messages: [], tables: {}, config: defaultConfig({ provider: 'fixture', model: 'fixture' }), turn: 0 },
    card: { name: '图书馆' }, worldbook: [], text: '开始。', emit() {}, trace: [],
    mapConcurrent: (items, _limit, fn) => Promise.all(items.map(fn)),
    data: { plotTasks: [
      { id: 'world', name: '世界观', stage: 1, order: 1, extractTags: 'world_rules', promptGroup: [{ role: 'USER', content: '规则' }] },
      { id: 'plot', name: '推进', stage: 1, order: 2, extractTags: 'scene', promptGroup: [{ role: 'USER', content: '背景：{{world_rules}}' }] },
    ] },
    callModel: async ({ label, messages }) => {
      seen.push({ label, text: JSON.stringify(messages) });
      if (label === '世界观') return { sections: { world_rules: '闭馆日不外借。' } };
      assert.match(JSON.stringify(messages), /闭馆日不外借/);
      return { sections: { scene: '馆员在门口等候。' } };
    },
  });
  assert.deepEqual(seen.map(item => item.label), ['世界观', '推进']);
  assert.match(result.injection, /馆员在门口等候/);
});
