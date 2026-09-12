import test from 'node:test';
import assert from 'node:assert/strict';
import * as worldbooks from '../src/worldbook.js';
import { assembleWritingPrompt, prepareWorldbook } from '../src/prompts.js';
import { defaultConfig } from '../src/contracts.js';

test('Worldbook lifecycle exposes real scan states and applies listener edits before prompt assembly', async () => {
  const card = { name: '图书馆', character_book: { name: '馆内资料', entries: [
    { id: 1, constant: true, content: '<if db="true">开放时间。</if>', insertion_order: 100 },
    { id: 2, keys: ['预约'], content: '阅览室需要登记。', insertion_order: 90 },
    { id: 3, keys: ['不会命中'], content: '内部记录。', insertion_order: 80 },
  ] } };
  const state = { id: 'events', userName: '访客', config: defaultConfig(), messages: [{ role: 'user', content: '参观。' }], tables: {}, renderMode: 'text' };
  const worldbook = await prepareWorldbook(state, card, [{ id: 'extra', name: '其他资料', data: { entries: [{ uid: 1, constant: true, content: '停车场。' }] } }]);
  const scans = [];
  let loaded = false;
  const result = await assembleWritingPrompt({ state, card, worldbook, scanWorldbook: async ({ entries, options }) => {
    return worldbooks.activateWorldbookWithEvents(entries, options, async (name, data) => {
      await Promise.resolve();
      if (name === 'worldinfo_entries_loaded') {
        loaded = true;
        assert.deepEqual(data.chatLore, []); assert.deepEqual(data.personaLore, []);
        assert.equal(data.globalLore[0].world, '其他资料');
        assert.equal(data.characterLore[0].uid, 1);
        assert.equal(data.characterLore[0].content, '开放时间。');
        data.characterLore[0].content += '预约';
        data.characterLore[2].key = ['预约'];
      } else {
        assert.equal(name, 'worldinfo_scan_done');
        assert.ok(loaded);
        assert.ok(data.activated.entries instanceof Map);
        assert.ok(Array.isArray(data.new.all) && Array.isArray(data.new.successful));
        assert.ok(Array.isArray(data.sortedEntries));
        assert.ok(Array.isArray(data.recursionDelay.availableLevels));
        assert.equal(typeof data.budget.overflowed, 'boolean');
        assert.equal(typeof data.timedEffects, 'object');
        scans.push({ ...data.state });
        if (!data.state.next) {
          data.activated.entries.delete('馆内资料.3');
          const entry = data.activated.entries.get('馆内资料.2');
          entry.content = '脚本确认：需提前预约。';
          entry.position = 4; entry.depth = 0; entry.role = 1;
        }
      }
    });
  } });
  assert.ok(loaded, 'writing must invoke the worldbook scan hook');
  assert.deepEqual(scans.map(scan => scan.current), [1, 2, 2]);
  assert.deepEqual(scans.map(scan => scan.next), [2, 2, 0]);
  assert.deepEqual(scans.map(scan => scan.loopCount), [1, 2, 3]);
  assert.deepEqual(result.worldEntryIds, ['card:2', 'card:1', 'extra:1']);
  assert.equal(result.messages.at(-1).role, 'user');
  assert.equal(result.messages.at(-1).content, '脚本确认：需提前预约。');
  assert.ok(!JSON.stringify(result.messages).includes('内部记录'));
  assert.equal(worldbook[0].content, '开放时间。');
});

test('Scan listeners can stop recursion and failures propagate without publishing a partial result', async () => {
  const entries = worldbooks.normalizeWorldbook({ entries: [{ uid: 1, constant: true, content: '触发' }, { uid: 2, key: ['触发'], content: '递归' }] });
  const events = [];
  const result = await worldbooks.activateWorldbookWithEvents(entries, { messages: [] }, async (name, data) => {
    events.push(name);
    if (name === 'worldinfo_scan_done') data.state.next = 0;
  });
  assert.deepEqual(result.entries.map(entry => entry.id), ['card:1']);
  assert.deepEqual(events, ['worldinfo_entries_loaded', 'worldinfo_scan_done']);
  await assert.rejects(worldbooks.activateWorldbookWithEvents(entries, { messages: [] }, async () => { throw Error('脚本失败'); }), /脚本失败/);
});
