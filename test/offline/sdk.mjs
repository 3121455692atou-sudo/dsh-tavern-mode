// Only message construction/retry policy used by model.js; no network client.
import { randomUUID } from 'node:crypto';
export const createMessage = value => ({ id: randomUUID(), ...value });
export const createSystemMessage = (text, plugin) => createMessage({ role: 'system', source: { kind: 'plugin', plugin }, content: [{ type: 'text', text }] });
export class LlmError extends Error { constructor(message, code, failure) { super(message); this.code = code; this.failure = failure; } }
export const resolveRetryPolicy = () => ({ mode: 'on-error', maxRetries: 2, retryableCodes: ['TRANSPORT', 'STREAM_CLOSED', 'EMPTY_RESPONSE'], initialDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 });
