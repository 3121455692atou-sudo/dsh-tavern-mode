import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function runFixture(status = 200) {
  const directory = await mkdtemp(join(tmpdir(), 'tavern-smoke-'));
  let requests = 0;
  const server = createServer(async (req, res) => {
    requests++;
    assert.equal(req.headers.authorization, 'Bearer TEST-ONLY-SECRET');
    const parts = []; for await (const part of req) parts.push(part);
    const body = JSON.parse(Buffer.concat(parts));
    assert.equal(body.tools[0].function.name, 'tavern_result');
    const input = JSON.parse(body.messages.at(-1).content);
    assert.ok(input.memories.length === 3);
    if (status !== 200) { res.writeHead(status).end(); return; }
    const id = input.userInput.includes('目录卡') ? 'm1' : input.userInput.includes('钥匙') ? 'm2' : 'm3';
    res.writeHead(200, { 'content-type': 'application/json' });
    // Deliberately no usage. The script must NOT invent token/cache values.
    res.end(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: 'tavern_result', arguments: JSON.stringify({ memoryIds: [id], reason: '对应已有记录。' }) } }] } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const report = join(directory, 'report.json');
  try {
    const child = spawn(process.execPath, [...(process.env.TAVERN_OFFLINE_TESTS === '1' ? ['--import', './test/offline/register.mjs'] : []), './scripts/verify-live.mjs', '--run', report], {
      cwd: new URL('..', import.meta.url), env: { ...process.env, TAVERN_VERIFY_API_KEY: 'TEST-ONLY-SECRET', TAVERN_VERIFY_MODEL: 'local-fixture', TAVERN_VERIFY_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, TAVERN_VERIFY_PAUSE_MS: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = ''; child.stderr.on('data', data => { stderr += data; }); child.stdout.resume();
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    assert.equal(stderr, '');
    const raw = await readFile(report, 'utf8'); assert.ok(!raw.includes('TEST-ONLY-SECRET'));
    return { code, requests, report: JSON.parse(raw) };
  } finally { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
}

test('live CLI sends at most six neutral probes and preserves unknown usage as null', async () => {
  const { code, requests, report } = await runFixture();
  assert.equal(code, 0); assert.equal(requests, 6);
  assert.equal(report.results.filter(result => result.status === 'passed').length, 6);
  for (const result of report.results) { assert.equal(result.usage.cacheHitTokens, null); assert.equal(result.usage.totalTokens, null); }
  assert.ok(report.results[3].wireCharacters < report.results[0].wireCharacters);
});

test('live CLI stops the suite after an authentication failure without retrying', async () => {
  const { code, requests, report } = await runFixture(401);
  assert.equal(code, 1); assert.equal(requests, 1);
  assert.equal(report.results[0].httpStatus, 401);
});
