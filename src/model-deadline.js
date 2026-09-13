// Heartbeats, usage and empty deltas do not count as model progress.
export function hasStreamContent(chunk) {
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') return typeof chunk.text === 'string' && chunk.text.length > 0;
  if (chunk.type === 'tool-call-delta') return typeof chunk.argumentsDelta === 'string' && chunk.argumentsDelta.length > 0;
  if (chunk.type === 'block-end') {
    const block = chunk.block;
    return block?.type === 'tool-call' ? !!block.arguments?.length : !!block?.text?.length;
  }
  return false;
}

// Only bound silence. Streaming content may continue for any total duration.
// One iterator.next() is outstanding even if the SDK ignores cancellation.
export async function* boundedStream(stream, options, { idleMs }) {
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let idle, rejectStopped;
  const stopped = new Promise((_, reject) => { rejectStopped = reject; });
  const abort = () => rejectStopped(signal.reason);
  const timeout = () => {
    const error = new Error(`模型连续 ${Math.round(idleMs / 1000)} 秒没有输出新内容；已停止本次请求，可从失败步骤继续`);
    error.code = 'TAVERN_TIMEOUT'; controller.abort(error);
  };
  const resetIdle = () => { clearTimeout(idle); if (idleMs) idle = setTimeout(timeout, idleMs); };
  signal.addEventListener('abort', abort, { once: true });
  resetIdle();
  let iterator;
  try {
    signal.throwIfAborted();
    iterator = stream({ ...options, signal })[Symbol.asyncIterator]();
    while (true) {
      const next = await Promise.race([iterator.next(), stopped]);
      if (next.done) return;
      if (hasStreamContent(next.value)) resetIdle();
      yield next.value;
    }
  } finally {
    clearTimeout(idle); signal.removeEventListener('abort', abort);
    if (!signal.aborted) controller.abort();
    // An uncooperative provider must not block the caller's timeout cleanup.
    void iterator?.return?.().catch(() => {});
  }
}
