import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// ESM reads package metadata through the lookup path before following symlinks.
// Grant only the worker's dependencies, including their hoisted/pnpm aliases.
const dependencyRoots = [...new Set(['lodash', 'yaml'].flatMap(name => {
  const resolved = realpathSync(dirname(require.resolve(`${name}/package.json`)));
  const roots = [resolved];
  for (const lookup of require.resolve.paths(name) ?? []) {
    const candidate = join(lookup, name);
    try {
      if (realpathSync(candidate) === resolved) roots.push(candidate);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
  }
  return roots;
}))];

export function renderTemplates(input, { signal, timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--permission', `--allow-fs-read=${source}`, ...dependencyRoots.map(path => `--allow-fs-read=${path}`), '--max-old-space-size=192',
      join(source, 'template-worker.js'),
    ], { env: { LANG: 'zh_CN.UTF-8', TZ: 'Asia/Shanghai' }, stdio: ['pipe', 'pipe', 'pipe'], signal });
    let output = '', stderr = '', settled = false;
    const timer = setTimeout(() => { child.kill('SIGKILL'); fail(new Error('提示词模板执行超时')); }, timeout);
    const fail = error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } };
    child.on('error', fail);
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') fail(error); });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', bytes => {
      output += bytes;
      if (output.length > 16_000_000) { child.kill('SIGKILL'); fail(new Error('模板输出超过 16 MB')); }
    });
    child.stderr.on('data', bytes => { if (stderr.length < 3000) stderr += bytes; });
    child.on('close', code => {
      if (settled) return;
      clearTimeout(timer);
      try {
        const result = JSON.parse(output);
        if (result.error || code !== 0) throw new Error(result.error ?? `模板进程退出：${code}`);
        settled = true;
        resolve(result);
      } catch (error) { fail(new Error(`提示词模板处理失败：${output ? error.message : stderr || error.message}`)); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
