import { WebSocketServer } from 'ws';

export function installNativeEvents(ctx, connect) {
  const server = new WebSocketServer({ noServer: true });
  const unregister = ctx.webServer.registerUpgrade({
    path: '/api/tavern/native-events',
    handler(req, socket, head) {
      const rejection = ctx.connection.requestRejection(req);
      if (rejection) {
        socket.end(`HTTP/1.1 ${rejection} ${rejection === 401 ? 'Unauthorized' : 'Forbidden'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
        return;
      }
      const id = new URL(req.url, 'http://localhost').searchParams.get('id');
      server.handleUpgrade(req, socket, head, client => {
        client.on('error', error => ctx.logger.warn(error));
        connect(id, client).catch(error => {
          if (client.readyState === 1) { client.send(JSON.stringify({ type: 'error', message: error.message })); client.close(1008); }
        });
      });
    },
  });
  return async () => {
    unregister();
    for (const client of server.clients) client.terminate();
    await new Promise(resolve => server.close(resolve));
  };
}
