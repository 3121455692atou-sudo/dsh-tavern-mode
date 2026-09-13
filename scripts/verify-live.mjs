// Opt-in, six-request OpenAI-compatible wire smoke test. It sends ONLY the
// neutral fixture below, never handoff data. It is NOT the DSH SDK adapter or
// a writing-quality benchmark. Missing usage/cache fields remain unknown.
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const help = `Usage: node scripts/verify-live.mjs --run [report.json]
Required environment: TAVERN_VERIFY_API_KEY, TAVERN_VERIFY_BASE_URL, TAVERN_VERIFY_MODEL.
BASE_URL is the OpenAI-compatible API root (without /chat/completions).
Optional TAVERN_VERIFY_MAX_TOKENS: 128..4096 (default 2048).
Optional TAVERN_VERIFY_PAUSE_MS: 0..30000 (default 2000).
Six requests maximum, no retries. Uses production makeModelCaller/contracts with
an explicit direct-wire adapter, NOT the installed DSH/CommandCode SDK route.
This is a neutral routing/schema/cache smoke test, NOT an end-to-end story A/B.
Do not use the offline test loader for this live check; install real dependencies.
No keys, request text or response text are included in the output report.`;
if (!process.argv.includes('--run')) { console.log(help); process.exit(0); }
const required = name => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };
const key = required('TAVERN_VERIFY_API_KEY'), model = required('TAVERN_VERIFY_MODEL');
const base = new URL(required('TAVERN_VERIFY_BASE_URL'));
if (base.username || base.password || base.search || base.hash) throw new Error('BASE_URL must not contain credentials, query parameters, or a fragment.');
if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(base.hostname))) throw new Error('Use HTTPS (or a localhost test endpoint).');
const integer = (name, fallback, min, max) => { const value = Number(process.env[name] ?? fallback); if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`); return value; };
const maxTokens = integer('TAVERN_VERIFY_MAX_TOKENS', 2048, 128, 4096);
const pause = integer('TAVERN_VERIFY_PAUSE_MS', 2000, 0, 30000);
const { makeModelCaller } = await import('../src/model.js');
const { focusedToolInput } = await import('../src/tool-policy.js');
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const results = [];
let sent = 0, active, abortSuite = false;
const numeric = value => Number.isFinite(value) && value >= 0 ? value : null;
const adapter = {
  providerRetryPolicy: () => ({ mode: 'never', maxRetries: 0, retryableCodes: [], initialDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 }),
  stream: async function* (options) {
    if (++sent > 6) throw Object.assign(new Error('Six-request ceiling reached'), { code: 'INVALID_REQUEST' });
    const messages = options.messages.map(message => ({ role: message.role, content: typeof message.content === 'string' ? message.content : message.content.map(block => block.text ?? '').join('') }));
    const body = { model, messages, stream: false, max_tokens: maxTokens,
      tools: options.tools?.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) };
    const serialized = JSON.stringify(body);
    if (serialized.length > 60000) throw Object.assign(new Error('Fixture request exceeded local character budget'), { code: 'INVALID_REQUEST' });
    active.wireCharacters = serialized.length; active.requestHash = sha(body);
    const response = await fetch(base.href.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: serialized, signal: AbortSignal.timeout(120000),
    });
    active.httpStatus = response.status;
    if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error(`HTTP ${response.status}; no retry`), { code: 'INVALID_REQUEST' }); }
    const data = await response.json(), choice = data.choices?.[0];
    if (!choice?.message) throw Object.assign(new Error('Missing choices[0].message'), { code: 'INVALID_REQUEST' });
    const u = data.usage ?? {};
    active.usage = {
      promptTokens: numeric(u.prompt_tokens), outputTokens: numeric(u.completion_tokens), totalTokens: numeric(u.total_tokens),
      cacheHitTokens: numeric(u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens),
      cacheMissTokens: numeric(u.prompt_cache_miss_tokens),
      reasoningTokens: numeric(u.completion_tokens_details?.reasoning_tokens),
    };
    active.responseHash = sha(choice.message); active.finishReason = choice.finish_reason ?? null;
    if (choice.message.content) yield { type: 'text-delta', text: choice.message.content };
    let index = 0;
    for (const tool of choice.message.tool_calls ?? []) yield { type: 'block-end', index: index++, block: { type: 'tool-call', name: tool.function?.name, arguments: tool.function?.arguments } };
    if (choice.message.reasoning_content) yield { type: 'block-end', index, block: { type: 'reasoning', text: choice.message.reasoning_content } };
    yield { type: 'finish', reason: { kind: choice.message.refusal ? 'refusal' : choice.finish_reason === 'length' ? 'max-tokens' : choice.finish_reason === 'content_filter' ? 'content_filter' : 'stop' } };
  },
};
const call = makeModelCaller(adapter);
const schema = { type: 'object', properties: { memoryIds: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' } }, required: ['memoryIds', 'reason'], additionalProperties: false };
const memories = [
  { id: 'm1', content: '成年馆员林岚昨天把红色目录卡放进二楼第三个抽屉。' },
  { id: 'm2', content: '成年管理员周远上周将备用钥匙放到一楼服务台的蓝盒里。' },
  { id: 'm3', content: '成年研究员叶宁今天预约了下午三点的阅览室。' },
];
// Distinct, neutral irrelevant reference entries, not padding for cache hits.
const worldbook = Array.from({ length: 90 }, (_, index) => ({ id: `archive-${index}`, title: `异地分馆${index}的历史`, content: `第${index}号分馆的阅览室建于${1900 + index}年，馆舍有${2 + index % 5}层。此资料不涉及本次目录卡、钥匙或预约，也不是任何角色的经历。` }));
const questions = ['红色目录卡在哪里？', '备用钥匙放在什么地方？', '叶宁几点预约了阅览室？'];
for (const mode of ['full', 'focused']) {
  if (abortSuite) break;
  for (let turn = 0; turn < 3; turn++) {
    active = { mode, turn: turn + 1, status: 'failed' }; results.push(active);
    const input = focusedToolInput('recall', { character: { id: 'a', name: '成年馆员林岚' }, worldbook, memories, userInput: questions[turn] }, { mode });
    try {
      const value = await call({ sessionId: `neutral-live-${mode}`, stage: 'recall', label: 'neutral-live',
        agent: { provider: 'explicit-direct-wire', model, maxTokens }, schema, retries: 0,
        messages: [{ role: 'system', content: '只从已给出的 memories 选择恰好一个与问题直接相关的记忆 ID，写一句简短理由。不要从世界书编造角色经历。' }, { role: 'user', content: JSON.stringify(input) }],
        onRequest: audit => { active.audit = audit; },
        onAttempt: attempt => { active.attemptStatus = attempt.status; active.attemptKind = attempt.kind; },
      });
      active.schemaValid = true; active.expectedMemorySelected = JSON.stringify(value.memoryIds) === JSON.stringify([`m${turn + 1}`]);
      active.resultHash = sha(value); active.status = active.expectedMemorySelected ? 'passed' : 'wrong-memory';
    } catch (error) {
      active.error = { code: error.code ?? error.name, phase: error.phase ?? null };
      // An endpoint/transport failure is not a reason to spend five more probes.
      if (active.httpStatus !== 200 && !active.usage) { abortSuite = true; break; }
    }
    if (sent < 6 && pause) await sleep(pause);
  }
}
const output = resolve(process.argv[process.argv.indexOf('--run') + 1] ?? 'verification/live-wire-smoke.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ generatedAt: new Date().toISOString(), type: 'opt-in-neutral-direct-wire-smoke', model, endpointOrigin: base.origin, maxRequests: 6, requestsSent: sent, results,
  limitations: ['Not the installed DSH/pi-ai transport.', 'No private fixtures; not a story-quality benchmark.', 'Three varying requests per mode; cache may need more time or may not be reported.', 'The two modes run sequentially and may share a warmed provider cache; not a randomized causal cache comparison.', 'Cache/token values are provider-returned only; null means unknown.'] }, null, 2) + '\n');
console.log(JSON.stringify({ report: output, sent, passed: results.filter(result => result.status === 'passed').length, total: results.length }, null, 2));
if (results.some(result => result.status !== 'passed')) process.exitCode = 1;
