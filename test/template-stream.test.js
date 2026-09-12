import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { renderTemplates } from '../src/templates.js';

test('template worker preserves UTF-8 characters split between stdin chunks', async t => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/template-worker.js', import.meta.url))]);
  t.after(() => child.kill());
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => { output += chunk; });
  const closed = once(child, 'close');
  child.stdin.write('{"texts":[{"text":"');
  await delay(300);
  for (const byte of Buffer.from('中文🎸')) {
    child.stdin.write(Buffer.from([byte]));
    await delay(25);
  }
  child.stdin.end('"}]}');
  assert.deepEqual(await closed, [0, null]);
  assert.deepEqual(JSON.parse(output).texts, ['中文🎸']);
});

test('template process round trip preserves long multibyte text and paragraph spacing', async () => {
  const text = '中文🎸日本語\n\n下一段　空格\n'.repeat(16000);
  const result = await renderTemplates({ texts: [{ text, macros: false, ejs: false, conditions: false }] });
  assert.deepEqual(result.texts, [text]);
});
