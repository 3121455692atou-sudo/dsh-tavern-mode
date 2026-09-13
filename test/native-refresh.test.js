import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserRuntime } from '../src/native-browser.js';

test('checkpoint and reconnect snapshots update React without erasing a running script draft', async t => {
  let payload = { state: { revision: 'first', messages: [] }, helper: { commit: 'same' }, generating: false };
  const syncs = [], sockets = []; let serverPort;
  const original = new Map();
  const globals = {
    fetch: async path => ({ ok: true, json: async () => String(path).endsWith('/bootstrap') ? { runtimeOrigin: 'http://runtime' } : structuredClone(payload) }),
    document: { documentElement: {}, head: {}, body: { hasAttribute: () => false, append() {} }, createElement: tag => {
      const element = { style: {}, setAttribute() {}, remove() {}, contentWindow: { postMessage(_data, _origin, ports) {
        serverPort = ports[0]; serverPort.onmessage = event => { const d = event.data; if (d.method === 'sync') syncs.push(d.args.state.revision); serverPort.postMessage({ type: 'result', id: d.id, value: true }); };
        serverPort.postMessage({ type: 'ready' });
      } } };
      if (tag === 'iframe') Object.defineProperty(element, 'src', { set() { queueMicrotask(() => element.onload()); } });
      return element;
    } },
    window: { innerHeight: 800, addEventListener() {}, removeEventListener() {} },
    getComputedStyle: () => ({ color: 'black', backgroundColor: 'white', fontFamily: 'sans' }),
    ResizeObserver: class { observe() {} disconnect() {} }, MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, location: { href: 'http://localhost/', protocol: 'http:' },
    WebSocket: class { constructor() { sockets.push(this); } close() {} },
  };
  for (const [key, value] of Object.entries(globals)) { original.set(key, globalThis[key]); globalThis[key] = value; }
  const runtime = createBrowserRuntime({ sessions: { scope() {} } });
  t.after(() => { runtime.dispose(); serverPort?.close(); for (const [key, value] of original) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; });
  await runtime.ensure('session');
  payload = { ...payload, generating: true, state: { revision: 'checkpoint', messages: [{ content: 'saved story' }] } };
  await sockets[0].onmessage({ data: JSON.stringify({ type: 'updated' }) });
  assert.equal(runtime.get('session').payload.state.revision, 'checkpoint');
  assert.deepEqual(syncs, []);
  payload = { ...payload, generating: false, state: { revision: 'missed-during-disconnect', messages: [{ content: 'saved story' }] } };
  await sockets[0].onmessage({ data: JSON.stringify({ type: 'connected' }) });
  assert.equal(runtime.get('session').payload.state.revision, 'missed-during-disconnect');
  assert.deepEqual(syncs, ['missed-during-disconnect']);
  payload = { state: null, config: { playMode: 'normal', concurrency: 3 } };
  await sockets[0].onmessage({ data: JSON.stringify({ type: 'connected' }) });
  assert.equal(runtime.get('session').payload, null);
  assert.equal(runtime.get('session').draftConfig.playMode, 'normal');
  assert.equal(runtime.get('session').draftConfig.concurrency, 3);
});
