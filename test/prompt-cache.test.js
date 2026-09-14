import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleWritingPrompt } from '../src/prompts.js';
import { runTurn } from '../src/pipeline.js';
import { inputTokens, trimHistory } from '../src/prompt-context.js';
import { normalizeWorldbook } from '../src/worldbook.js';
import { defaultConfig, validateConfig } from '../src/contracts.js';
const card = { name: '馆员', description: '固定人物设定', character_book: { entries: [] } };
const state = mode => ({ id: 'cache', renderMode: 'text', userName: '访客', config: { ...defaultConfig(), playMode: mode }, tables: {}, variables: {}, messages: [
  { role: 'user', content: '更早的问题' }, { role: 'assistant', content: '更早的完整正文' },
  { role: 'user', content: '上轮问题' }, { role: 'assistant', content: '上一条原文\n\n保留　空格与 {{字面标记}}' },
  { role: 'user', content: '现在的问题' },
] });
test('agent writer keeps only the latest unmodified story and the current user input', async () => {
  const input = state('agent');
  const result = await assembleWritingPrompt({ state: input, card, worldbook: [] });
  assert.deepEqual(result.messages.filter(m => m.role !== 'system'), input.messages.slice(-2));
  assert.equal(input.messages.length, 5);
});
test('normal writer keeps history without summary and truncates oldest text to its input budget', async () => {
  const input = state('normal');
  const original = await assembleWritingPrompt({ state: input, card, worldbook: [] });
  assert.deepEqual(original.messages.filter(m => m.role !== 'system'), input.messages);
  input.config.normalMaxInputTokens = 250;
  input.messages.unshift({ role: 'assistant', content: '很早的历史'.repeat(200) });
  const limited = await assembleWritingPrompt({ state: input, card, worldbook: [] });
  assert.ok(!limited.messages.some(m => m.content.includes('很早的历史'.repeat(100))));
  assert.ok(limited.messages.some(m => m.content === '现在的问题'));
  assert.equal(input.messages[0].content.length, 1000);
});
test('normal input defaults to 200k and has no application maximum', () => {
  assert.equal(defaultConfig().normalMaxInputTokens, 200000);
  const config = defaultConfig();config.normalMaxInputTokens = 5000000;
  assert.equal(validateConfig(config).normalMaxInputTokens, 5000000);
});

test('fixed writing instructions precede changing worldbook and history in both modes', async () => {
  for (const mode of ['normal', 'agent']) {
    const input = state(mode);
    input.variables.turn = 1;
    const books = normalizeWorldbook({ entries: [
      { uid: 1, constant: true, order: 1, content: '动态 {{getvar::turn}}' },
      { uid: 2, constant: true, order: 2, content: '不变的世界设定' },
    ] });
    const a = await assembleWritingPrompt({ state: input, card, worldbook: books });
    input.variables.turn = 2; input.messages.at(-1).content = '另一轮输入';
    const b = await assembleWritingPrompt({ state: input, card, worldbook: books });
    const prefix = a.messages.findIndex(message => message.content.includes('动态'));
    assert.ok(prefix >= 3);
    assert.deepEqual(a.messages.slice(0,prefix),b.messages.slice(0,prefix));
    assert.ok(b.messages.some(message => message.content === '动态 2'));
  }
});
test('normal mode enforces the budget after frontend prompt additions without calling agents', async () => {
  const input = state('normal'); input.config.normalMaxInputTokens = 250;
  input.messages = [{role:'user',content:'继续'}, {role:'assistant',content:'旧正文'.repeat(200)}];
  let calls = 0;
  await runTurn({ state: input, card, text: '继续',
    beforeWrite: async value => ({ ...value, messages: [...value.messages,{role:'system',content:'前端追加的格式要求'.repeat(3)}] }),
    callModel: async ({ stage, messages }) => {
      calls++; assert.equal(stage,'write'); assert.ok(inputTokens(messages) <= 250);
      assert.ok(messages.some(message => message.role === 'user' && message.content === '继续'));
      assert.ok(messages.some(message => message.content.includes('前端追加的格式要求')));
      return '下一段正文。';
    },
  });
  assert.equal(calls,1); assert.equal(input.messages[1].content.length,600);
});
test('truncation preserves Unicode and the newest suffix, rejects an oversized fixed prompt', () => {
  const messages = [{role:'assistant',history:true,content:'旧'.repeat(200000)+'😀结尾'}, {role:'user',content:'当前输入'}];
  const result = trimHistory(messages,30);
  assert.ok(inputTokens(result) <= 30); assert.ok(result[0].content.endsWith('😀结尾'));
  assert.ok(!/[\uD800-\uDFFF]/u.test(result[0].content.replace('😀','')));
  assert.throws(() => trimHistory([{role:'system',content:'固定'.repeat(100)}],30),/固定提示词/);
});
