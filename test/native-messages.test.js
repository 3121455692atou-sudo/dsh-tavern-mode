import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

// Exercise the component's event handlers without a browser or DSH runtime.
function harness(props, clipboard) {
  const hooks = [], actions = []; let cursor = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter(Boolean) }),
    useState(value) { const index = cursor++; hooks[index] ??= value; return [hooks[index], value => { hooks[index] = value; }]; },
    useRef() { const index = cursor++; return hooks[index] ??= { current: { focus() {}, select() {} } }; },
  };
  const module = { exports: {} };
  const { code } = transformSync(readFileSync(new URL('../src/native-messages.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' });
  runInNewContext(code, { module, exports: module.exports, require: () => React, navigator: { clipboard } });
  const Component = module.exports.createMessageActions({ messageAction: async (...args) => actions.push(args) });
  return { actions, render: () => { cursor = 0; return Component(props); } };
}
const all = node => typeof node === 'object' ? [node, ...node.children.flatMap(all)] : [];
const button = (tree, label) => all(tree).find(node => node.type === 'button' && node.children.join('') === label);

test('Settled reasoning is expandable and copied verbatim while manual editing changes only the body', async () => {
  const reasoning = '<think>核对场景。</think>\n<story_plot>' + '管理员递来档案。\n'.repeat(2000) + '</story_plot>';
  const copied = [];
  const ui = harness({ sessionId: 'chat', payload: { state: {}, generating: false }, message: { id: 'a', content: '旧正文', extra: { reasoning } }, role: 'assistant', children: '旧正文' }, { writeText: async text => copied.push(text) });
  let tree = ui.render();
  assert.ok(all(tree).some(node => node.type === 'details'));
  assert.equal(all(tree).find(node => node.type === 'textarea').props.value, reasoning);
  await button(tree, '复制全部思考').props.onClick();
  assert.deepEqual(copied, [reasoning]);
  button(tree, '编辑').props.onClick(); tree = ui.render();
  assert.ok(all(tree).some(node => node.type === 'details'));
  const editor = all(tree).find(node => node.type === 'textarea' && !node.props.readOnly);
  editor.props.onChange({ target: { value: '管理员递来档案。' } }); tree = ui.render();
  await button(tree, '保存').props.onClick();
  assert.equal(ui.actions.length, 1);
  assert.equal(ui.actions[0][1].text, '管理员递来档案。');
  assert.equal(ui.actions[0][1].action, 'edit');
});

test('Native reasoning is available when no plugin reasoning was saved', async () => {
  const copied = [];
  const ui = harness({ sessionId: 'chat', payload: { state: {} }, message: { id: 'a' }, role: 'assistant', reasoning: '原生思考原文', children: '正文' }, { writeText: async text => copied.push(text) });
  await button(ui.render(), '复制全部思考').props.onClick();
  assert.deepEqual(copied, ['原生思考原文']);
});
