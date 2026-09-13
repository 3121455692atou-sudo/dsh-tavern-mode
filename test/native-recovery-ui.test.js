import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

function harness(props, retryFailed) {
  const hooks = []; let cursor = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter(Boolean) }),
    useState(value) { const index = cursor++; hooks[index] ??= value; return [hooks[index], value => { hooks[index] = value; }]; },
    useRef(value) { const index = cursor++; return hooks[index] ??= { current: value }; },
  };
  const module = { exports: {} };
  const { code } = transformSync(readFileSync(new URL('../src/native-recovery-ui.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' });
  runInNewContext(code, { module, exports: module.exports, require: () => React });
  const Component = module.exports.createRecoveryNotice({ retryFailed });
  return () => { cursor = 0; return Component(props); };
}
const all = node => node && typeof node === 'object' ? [node, ...node.children.flatMap(all)] : [];
const button = tree => all(tree).find(node => node.type === 'button');

test('resume button is available before any prose, passes the saved turn token, and rejects double clicks', async () => {
  const calls = []; let release;
  const props = { sessionId: 'session', ready: true, payload: { state: { messages: [] }, generating: false,
    recovery: { kind: 'turn', token: 'saved-turn', label: '推进', completedSteps: 3, failures: [{ label: '推进' }] } } };
  const render = harness(props, (...args) => { calls.push(args); return new Promise(resolve => { release = resolve; }); });
  const control = button(render()); assert.equal(control.children.join(''), '从「推进」继续'); assert.equal(control.props.disabled, false);
  const submitted = control.props.onClick(); await control.props.onClick();
  assert.equal(button(render()).props.disabled, true); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['session', 'saved-turn']); release(); await submitted;
  props.payload.generating = true; assert.equal(render(), null);
  props.payload.generating = false; props.payload.recovery = null; assert.equal(render(), null);
});

test('retry submission errors are visible and the button becomes usable again', async () => {
  const render = harness({ sessionId: 'session', ready: true, payload: { recovery: { token: 'saved', label: '推进', completedSteps: 0 } } }, async () => { throw new Error('前端未就绪'); });
  await button(render()).props.onClick();
  assert.equal(button(render()).props.disabled, false);
  assert.equal(all(render()).find(node => node.props.role === 'alert').children.join(''), '前端未就绪');
});

test('imported opening remains rendered after native blank changes on a runtime event', () => {
  const module = { exports: {} };
  const React = { createElement: (type, props, ...children) => ({ type, props, children }) };
  const { code } = transformSync(readFileSync(new URL('../src/native-opening.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' });
  runInNewContext(code, { module, exports: module.exports, require: () => React });
  const Opening = module.exports.createOpening(message => message.content);
  const payload = { state: { nativeAnchorSeq: -1, messages: [{ greeting: true, id: 'intro', content: '<div>开场交互界面</div>' }] } };
  for (const blank of [true, false]) {
    payload.state.nativeAnchorSeq++;
    const rendered = Opening({ payload, greetingOnly: true, blank });
    assert.equal(rendered.children[0], '<div>开场交互界面</div>');
  }
});
