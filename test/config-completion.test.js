import test from 'node:test';
import assert from 'node:assert/strict';
import { completeConfig, validateConfig } from '../src/contracts.js';

test('switching a fresh session to normal mode fills configuration before validation', () => {
  const config = completeConfig(undefined, { playMode: 'normal' });
  validateConfig(config); assert.equal(config.playMode, 'normal');
  assert.equal(Object.keys(config.agents).length, 6); assert.equal(config.concurrency, 4);
});

test('mode-only changes preserve custom provider, reasoning, budget and per-stage settings', () => {
  const previous = completeConfig({ concurrency: 2, agents: { write: { provider: 'mine', model: 'chosen', reasoningEffort: 'high', maxTokens: 6000 } } });
  const before = structuredClone(previous);
  const next = completeConfig(previous, { playMode: 'normal' }); validateConfig(next);
  assert.deepEqual(next.agents, previous.agents); assert.equal(next.concurrency, 2);
  assert.deepEqual(previous, before);
  for (const patch of [{ playMode: 'invalid' }, { concurrency: 0 }, { agents: { write: { maxTokens: -1 } } }]) assert.throws(() => validateConfig(completeConfig(previous, patch)));
});
