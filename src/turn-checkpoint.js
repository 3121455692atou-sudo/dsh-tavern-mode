import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson, readJson } from './storage.js';
import { validateProtocol } from './contracts.js';

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const pathFor = (store, id) => join(store.sessionDir(id), 'turn-checkpoint.json');
export const clearTurnCheckpoint = (store, id) => rm(pathFor(store, id), { force: true });

// Only resumes an uncommitted turn with identical source state and assets.
// This is a local completed-stage checkpoint, not a provider token cache.
export async function openTurnCheckpoint({ store, state, assets, text, trigger = 'normal' }) {
  const { revision, previousRevision, updatedAt, lastRun, turnStartedAt, ...context } = state;
  const scope = digest({ version: 1, context, assets, text, trigger });
  const path = pathFor(store, state.id);
  await mkdir(store.sessionDir(state.id), { recursive: true, mode: 0o700 });
  let checkpoint = await readJson(path, null);
  if (checkpoint?.scope !== scope) {
    checkpoint = { scope, identity: { seed: randomUUID(), startedAt: new Date().toISOString() }, results: {} };
    await atomicJson(path, checkpoint);
  }
  const identity = {
    startedAt: checkpoint.identity.startedAt,
    id: label => {
      const hash = digest([checkpoint.identity.seed, label]);
      return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    },
  };
  return { identity, wrap(callModel) {
    const occurrences = new Map();
    return async options => {
      options.signal?.throwIfAborted();
      const input = digest({ stage: options.stage, label: options.label, agent: options.agent, messages: options.messages, schema: options.schema, repairContext: options.repairContext });
      const occurrence = occurrences.get(input) ?? 0; occurrences.set(input, occurrence + 1);
      const key = `${input}:${occurrence}`;
      const previous = checkpoint.results[key];
      if (previous) {
        const value = structuredClone(previous.value);
        if (options.schema) validateProtocol(value, options.schema);
        await options.validate?.(value);
        options.onRequest?.({ kind: 'local-stage-reuse', reused: true, stage: options.stage, label: options.label, completedAt: previous.completedAt, inputHash: input });
        if (previous.reasoning) options.onReasoning?.(previous.reasoning);
        if (typeof value === 'string') options.onText?.(value);
        return value;
      }
      let reasoning;
      const value = await callModel({ ...options, onReasoning: text => { reasoning = text; options.onReasoning?.(text); } });
      if (options.schema) validateProtocol(value, options.schema);
      await options.validate?.(value);
      // Serialize concurrent completions; never write over a newer scope.
      await store.exclusive(`turn-checkpoint:${state.id}`, async () => {
        const current = await readJson(path, null);
        if (current?.scope !== scope) return;
        current.results[key] = { value, ...(reasoning ? { reasoning } : {}), completedAt: new Date().toISOString() };
        await atomicJson(path, current); checkpoint = current;
      });
      return value;
    };
  } };
}
