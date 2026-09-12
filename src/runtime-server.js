import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { transform } from 'esbuild';
import { frontendModules } from './frontend-modules.js';

export async function compileFrontend(code) {
  return (await transform(code, { target: 'es2022', charset: 'utf8', logLevel: 'silent', define: { 'window.top': '__tavernHost', 'globalThis.top': '__tavernHost', top: '__tavernHost' } })).code;
}

export async function startRuntimeServer(ctx, root, helper, moduleCache) {
  const modules = frontendModules(moduleCache);
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>html{color-scheme:inherit}html,body{margin:0;background:transparent;color:var(--tavern-color,#ddd);font:14px/1.7 system-ui}#chat,#compat-composer,#extensionsMenu{display:none}iframe{border:0;width:100%;display:block;background:transparent;color-scheme:inherit}button{font:inherit;cursor:pointer}</style></head><body><div id="tavern_helper"></div><div id="script-buttons"></div><div id="extensions_settings2"><div class="regex_settings"><div id="saved_regex_scripts"></div></div></div><div id="completion_prompt_manager"></div><div id="openai_preset_import_file" hidden></div><div id="extensionsMenu"></div><div id="chat"></div><div id="compat-composer"><textarea id="send_textarea"></textarea><button id="send_but"></button></div><script src="/realm.js"></script></body></html>';
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost'), path = url.pathname;
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (req.method === 'GET' && path === '/module') {
      res.setHeader('content-type', 'text/javascript; charset=utf-8');
      try { res.end(await modules.load(url.searchParams.get('url'), origin)); }
      catch (error) { res.writeHead(502); res.end(`throw new Error(${JSON.stringify(error.message)});`); }
      return;
    }
    if (req.method === 'GET' && path === '/tavern-helper.js') {
      res.setHeader('content-type', 'text/javascript; charset=utf-8'); res.setHeader('cache-control', 'no-store');
      res.end(await readFile(helper?.bundle() ?? join(root, 'lib/tavern-helper.js'))); return;
    }
    if (req.method === 'POST' && path === '/compile') {
      res.setHeader('content-type', 'application/json');
      try {
        let bytes = 0, chunks = [];
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 128 * 1024 * 1024) throw new Error('前端代码超过 128 MB'); chunks.push(chunk); }
        const code = JSON.parse(Buffer.concat(chunks));
        if (!Array.isArray(code) || code.some(value => typeof value !== 'string')) throw new Error('前端代码应为字符串列表');
        res.end(JSON.stringify({ code: await Promise.all(code.map(source => modules.compile(source, undefined, origin))) }));
      } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error: error.message })); }
      return;
    }
    if (req.method === 'GET' && path === '/version') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ pkgVersion: '1.14.0', compatibility: true, product: 'dsh-tavern-mode', productVersion: '0.4.0' })); return; }
    if (req.method === 'GET' && path === '/fontawesome.css') {
      const styles = await Promise.all(['fontawesome.min.css', 'solid.min.css', 'brands.min.css'].map(name => readFile(join(root, 'vendor/fontawesome', name), 'utf8')));
      res.setHeader('content-type', 'text/css'); res.end(styles.join('\n')); return;
    }
    if (req.method === 'GET' && ['fa-solid-900.woff2', 'fa-solid-900.ttf', 'fa-brands-400.woff2', 'fa-brands-400.ttf'].some(name => path === '/webfonts/' + name)) {
      res.setHeader('content-type', path.endsWith('.woff2') ? 'font/woff2' : 'font/ttf');
      res.end(await readFile(join(root, 'vendor/fontawesome', path.split('/').at(-1)))); return;
    }
    const nativeModules = { '/scripts/openai.js': ['promptManager', 'MessageCollection', 'Message', 'sendOpenAIRequest'], '/scripts/preset-manager.js': ['getPresetManager'], '/scripts/utils.js': ['equalsIgnoreCaseAndAccents', 'getSanitizedFilename'], '/script.js': ['streamingProcessor', 'displayVersion'] };
    if (req.method === 'GET' && nativeModules[path]) { res.setHeader('content-type', 'text/javascript'); res.end(nativeModules[path].map(name => `export const ${name} = window.__tavernModules.${name};`).join('\n')); return; }
    if (req.method !== 'GET' || !['/host', '/component', '/realm.js', '/component.js'].includes(path)) { res.writeHead(404); res.end(); return; }
    res.setHeader('content-security-policy', "default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https:; style-src 'self' 'unsafe-inline' https:; img-src data: blob: https: http:; font-src 'self' data: blob: https:; media-src data: blob: https:; frame-src 'self' about: blob:; connect-src 'self' https:; base-uri 'none'; form-action 'none'");
    res.setHeader('cache-control', 'no-store');
    res.setHeader('content-type', path.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
    try {
      if (path === '/host') res.end(html);
      else if (path === '/component') res.end('<!doctype html><html><head><meta charset="utf-8"><style>html{color-scheme:inherit}html,body{margin:0;overflow:hidden;background:transparent}iframe{display:block;width:100%;border:0;height:1px;background:transparent;color-scheme:inherit}</style></head><body><script src="/component.js"></script></body></html>');
      else res.end(await readFile(join(root, 'lib', path.slice(1))));
    } catch { res.writeHead(500); res.end('前端资源尚未构建'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  ctx.effect(() => () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
