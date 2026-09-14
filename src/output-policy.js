import { AsyncLocalStorage } from 'node:async_hooks';

const scope = new AsyncLocalStorage();
const wrappers = new WeakSet();
const limitFields = ['max_tokens', 'max_completion_tokens', 'max_output_tokens'];

// DSH's pi-ai adapter fills in model.maxTokens (32K for a custom route),
// even when GenerateOptions.maxTokens is absent. The public DSH seam does
// not expose pi-ai's onPayload hook. Remove those optional wire fields only
// within a Tavern model call; concurrent native DSH requests stay untouched.
// Anthropic Messages requires max_tokens, so it cannot use this omission.
function installFetchBoundary() {
  if (wrappers.has(globalThis.fetch)) return;
  const next = globalThis.fetch;
  const wrapped = async function (input, init) {
    const active = scope.getStore();
    if (!active) return next(input, init);
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (method.toUpperCase() !== 'POST' || !/\/(?:chat\/completions|responses)\/?$/.test(url.pathname)) return next(input, init);
    const request = new Request(input instanceof Request ? input.clone() : input, init);
    let body;
    try { body = await request.json(); } catch { return next(input, init); }
    if (!body || typeof body.model !== 'string' || !(Array.isArray(body.messages) || Object.hasOwn(body, 'input'))) return next(input, init);
    const removed = {};
    for (const field of limitFields) if (Object.hasOwn(body, field)) { removed[field] = body[field]; delete body[field]; }
    active.onWire?.({ protocol: /\/responses\/?$/.test(url.pathname) ? 'responses' : 'chat-completions', removed });
    if (!Object.keys(removed).length) return next(input, init);
    const headers = new Headers(request.headers); headers.delete('content-length');
    // Preserve non-Request fetch options too (notably a proxy dispatcher).
    return next(input, { ...init, headers, body: JSON.stringify(body) });
  };
  wrappers.add(wrapped);
  globalThis.fetch = wrapped;
}

export function withoutOutputLimit(work, onWire) {
  installFetchBoundary();
  return scope.run({ onWire }, work);
}
