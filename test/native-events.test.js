import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import { installNativeEvents } from '../src/native-events.js';

test('Native event sockets authenticate upgrades and leave ordinary HTTP available with many open sessions', async () => {
  const server = createServer((_req, res) => res.end('ready'));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const clients = [], connected = [];
  const ctx = {
    connection: { requestRejection: req => req.headers.cookie === 'fixture=1' && req.headers.origin === origin ? undefined : 401 },
    webServer: { registerUpgrade(route) {
      const handler = (req, socket, head) => route.handler(req, socket, head);
      server.on('upgrade', handler); return () => server.off('upgrade', handler);
    } },
    logger: { warn: error => { throw error; } },
  };
  const dispose = installNativeEvents(ctx, async (id, client) => {
    if (id === 'missing') throw new Error('会话不存在');
    connected.push(id); client.send(JSON.stringify({ id }));
  });
  const open = id => {
    const client = new WebSocket(origin.replace('http:', 'ws:') + '/api/tavern/native-events?id=' + id, { headers: { cookie: 'fixture=1', origin } });
    clients.push(client); return client;
  };
  try {
    const messages = await Promise.all(Array.from({ length: 8 }, async (_value, index) => {
      const client = open('session-' + index);
      return JSON.parse(String((await once(client, 'message'))[0]));
    }));
    assert.deepEqual(messages.map(value => value.id), Array.from({ length: 8 }, (_value, index) => 'session-' + index));
    assert.equal(connected.length, 8);
    assert.equal(await (await fetch(origin, { signal: AbortSignal.timeout(2000) })).text(), 'ready');
    const missing = open('missing'), closed = once(missing, 'close');
    assert.deepEqual(JSON.parse(String((await once(missing, 'message'))[0])), { type: 'error', message: '会话不存在' });
    assert.equal((await closed)[0], 1008);
    const denied = new WebSocket(origin.replace('http:', 'ws:') + '/api/tavern/native-events?id=denied');
    denied.on('error', () => {});
    const [request, response] = await once(denied, 'unexpected-response');
    assert.equal(response.statusCode, 401); response.resume(); request.destroy();
  } finally {
    for (const client of clients) client.terminate();
    await dispose(); await new Promise(resolve => server.close(resolve));
  }
});
