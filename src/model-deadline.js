// Bound both silence and total elapsed time, including SDKs which do not stop
// their iterator promptly on abort. Only one iterator.next() is outstanding.
export async function* boundedStream(stream, options, { totalMs, idleMs }) {
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let total, idle, rejectStopped;
  const stopped = new Promise((_, reject) => { rejectStopped = reject; });
  const abort = () => rejectStopped(signal.reason);
  const timeout = kind => {
    const error = new Error(kind === 'idle' ? `工具模型连续 ${Math.round(idleMs / 1000)} 秒没有返回数据；已停止本次请求，可单独重试` : `工具模型请求超过 ${Math.round(totalMs / 1000)} 秒；已停止本次请求，可单独重试`);
    error.code = 'TAVERN_TIMEOUT'; controller.abort(error);
  };
  const resetIdle = () => { clearTimeout(idle); if (idleMs) idle = setTimeout(() => timeout('idle'), idleMs); };
  signal.addEventListener('abort', abort, { once: true });
  if (totalMs) total = setTimeout(() => timeout('total'), totalMs);
  resetIdle();
  let iterator;
  try {
    signal.throwIfAborted();
    iterator = stream({ ...options, signal })[Symbol.asyncIterator]();
    while (true) {
      const next = await Promise.race([iterator.next(), stopped]);
      if (next.done) return;
      resetIdle(); yield next.value;
    }
  } finally {
    clearTimeout(total); clearTimeout(idle); signal.removeEventListener('abort', abort);
    if (!signal.aborted) controller.abort();
    // An uncooperative provider must not block the caller's timeout cleanup.
    void iterator?.return?.().catch(() => {});
  }
}
