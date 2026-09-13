import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson, readJson } from './storage.js';
import { validateProtocol } from './contracts.js';

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const pathFor = (store, id) => join(store.sessionDir(id), 'turn-checkpoint.json');
export const readTurnCheckpoint = (store, id) => readJson(pathFor(store, id), null);
export const clearTurnCheckpoint = (store, id) => rm(pathFor(store, id), { force: true });

// Only resumes an uncommitted turn with identical source state and assets.
// This is a local completed-stage checkpoint, not a provider token cache.
export async function openTurnCheckpoint({ store, state, assets, text, trigger = 'normal', request, resume = false }) {
  const { revision, previousRevision, updatedAt, lastRun, turnStartedAt, nativeAnchorSeq, nativeMessageId, ...context } = state;
  const scope = digest({ version: 2, context, assets, text, trigger });
  const path = pathFor(store, state.id);
  await mkdir(store.sessionDir(state.id), { recursive: true, mode: 0o700 });
  let checkpoint = await readJson(path, null);
  if (checkpoint && checkpoint.scope !== scope && checkpoint.version !== 2) {
    // Older checkpoints accidentally hashed native log cursors as story input.
    // Opening a page or recording a retry advances those cursors. Migrate only
    // if ALL actual prompt sources still match the old digest exactly.
    const matches = metadata => checkpoint.scope === digest({ version: 1, context: { ...context, nativeAnchorSeq: metadata.nativeAnchorSeq, nativeMessageId: metadata.nativeMessageId }, assets, text, trigger });
    let candidate = state; const seen = new Set();
    while (candidate && !matches(candidate) && candidate.previousRevision && !seen.has(candidate.previousRevision)) {
      seen.add(candidate.previousRevision);
      candidate = await readJson(join(store.sessionDir(state.id), 'revisions', candidate.previousRevision, 'state.json'), null);
    }
    if (candidate && matches(candidate)) { checkpoint.scope = scope; checkpoint.version = 2; await atomicJson(path, checkpoint); }
  }
  let legacyResume = !!(resume && checkpoint && checkpoint.scope !== scope && checkpoint.version !== 2);
  if (checkpoint?.scope !== scope && !legacyResume) {
    if (resume) throw new Error('本轮输入、设置或资料已改变，无法安全复用之前的步骤；没有重新请求模型，请使用原消息的重新生成操作。');
    checkpoint = { version: 2, scope, identity: { seed: randomUUID(), startedAt: new Date().toISOString() }, results: {} };
    await atomicJson(path, checkpoint);
  }
  let writeScope = checkpoint.scope;
  if (request && !checkpoint.request && !legacyResume) { checkpoint.request = { ...request, text }; await atomicJson(path, checkpoint); }
  const identity = {
    startedAt: checkpoint.identity.startedAt,
    id: label => {
      const hash = digest([checkpoint.identity.seed, label]);
      return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    },
  };
  return { identity, wrap(callModel) {
    const occurrences = new Map(), reused = new Set();
    return async options => {
      options.signal?.throwIfAborted();
      const input = digest({ stage: options.stage, label: options.label, agent: options.agent, messages: options.messages, schema: options.schema, repairContext: options.repairContext });
      const occurrence = occurrences.get(input) ?? 0; occurrences.set(input, occurrence + 1);
      const key = `${input}:${occurrence}`;
      const previous = checkpoint.results[key];
      if (previous) {
        reused.add(key);
        const value = structuredClone(previous.value);
        if (options.schema) validateProtocol(value, options.schema);
        await options.validate?.(value);
        options.onRequest?.({ kind: 'local-stage-reuse', reused: true, stage: options.stage, label: options.label, completedAt: previous.completedAt, inputHash: input });
        if (previous.reasoning) options.onReasoning?.(previous.reasoning);
        if (typeof value === 'string') options.onText?.(value);
        return value;
      }
      let reasoning;
      let value;
      try {
        if (legacyResume) {
          // Old frontends did not save the prepared runtime snapshot. Check
          // the exact hashes of EVERY completed request before admitting any
          // paid work. Harmless host metadata can then be migrated safely.
          await Promise.resolve();
          if (Object.keys(checkpoint.results).some(savedKey => !reused.has(savedKey))) throw new Error('上次成功步骤的实际请求已改变；已停止继续，避免重复计费。请恢复该步骤的原设置。');
          await store.exclusive(`turn-checkpoint:${state.id}`, async () => {
            const current = await readJson(path, null);
            if (current?.scope !== writeScope) throw new Error('会话已发生变化，请重新读取当前状态');
            current.scope = scope; current.version = 2;
            if (request && !current.request) current.request = { ...request, text };
            await atomicJson(path, current); checkpoint = current; writeScope = scope; legacyResume = false;
          });
        }
        if (resume && Object.entries(checkpoint.results).some(([savedKey, result]) => !reused.has(savedKey) && result.stage === options.stage && result.label === options.label)) {
          throw new Error('已完成步骤的提示词发生变化，已停止继续，避免重复请求；请检查预设或使用原消息的重新生成操作。');
        }
        value = await callModel({ ...options, onReasoning: text => { reasoning = text; options.onReasoning?.(text); } });
        if (options.schema) validateProtocol(value, options.schema);
        await options.validate?.(value);
      }
      catch (error) {
        await store.exclusive(`turn-checkpoint:${state.id}`, async () => {
          const current = await readJson(path, null); if (current?.scope !== writeScope) return;
          (current.failures ??= {})[key] = { stage: options.stage, label: options.label ?? options.stage, message: error?.message ?? '本轮已停止', code: error?.code, failedAt: new Date().toISOString() };
          await atomicJson(path, current); checkpoint = current;
        });
        throw error;
      }
      // Serialize concurrent completions; never write over a newer scope.
      await store.exclusive(`turn-checkpoint:${state.id}`, async () => {
        const current = await readJson(path, null);
        if (current?.scope !== writeScope) return;
        current.results[key] = { value, stage: options.stage, label: options.label, ...(reasoning ? { reasoning } : {}), completedAt: new Date().toISOString() };
        if (current.failures) delete current.failures[key];
        await atomicJson(path, current); checkpoint = current;
      });
      return value;
    };
  } };
}
