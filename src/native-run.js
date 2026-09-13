import { randomUUID } from 'node:crypto';
import { stageLabels } from './defaults.js';

export function mergeTokenUsage(into, extra) {
  if (!extra) return into;
  const add = (left, right) => (left ?? 0) + (right ?? 0);
  const next = {
    inputTokens: add(into?.inputTokens, extra.inputTokens),
    outputTokens: add(into?.outputTokens, extra.outputTokens),
  };
  for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens']) {
    if (into?.[key] != null || extra[key] != null) next[key] = add(into?.[key], extra[key]);
  }
  next.totalTokens ??= next.inputTokens + next.outputTokens + (next.cacheReadTokens ?? 0) + (next.cacheWriteTokens ?? 0);
  return next;
}

const emptyUsage = () => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
const runError = reason => reason instanceof Error ? reason : new Error(reason?.kind === 'user' ? '用户已停止本轮' : String(reason?.message ?? reason?.kind ?? reason ?? '生成已停止'));

// The pipeline pauses at each model call. DSH dispatches these calls as real tools.
export class NativeRun {
  constructor({ work, callModel, signal, onAttempt }) {
    this.controller = new AbortController();
    this.signal = signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal;
    this.tasks = new Map();
    this.waiters = new Set();
    this.pendingUsage = null;
    this.callModel = async options => callModel({
      ...options,
      onUsage: usage => { this.addUsage(usage); options.onUsage?.(usage); },
    });
    this.onAttempt = onAttempt;
    this.signal.addEventListener('abort', () => {
      this.error = runError(this.signal.reason);
      for (const task of this.tasks.values()) if (task.status === 'queued' || task.status === 'offered') task.reject(this.error);
      this.wake();
    }, { once: true });
    this.completion = Promise.resolve().then(() => work(options => this.enqueue(options), this.signal)).then(value => {
      this.value = value; this.done = true; this.wake();
    }, error => { this.error = error; this.done = true; this.controller.abort(error); this.wake(); });
  }
  wake() { for (const resolve of this.waiters) resolve(); this.waiters.clear(); }
  enqueue(options) {
    this.signal.throwIfAborted();
    const id = randomUUID(), stage = options.stage ?? (options.schema ? 'combine' : 'write');
    return new Promise((resolve, reject) => {
      this.tasks.set(id, { id, stage, label: options.label ?? stageLabels[stage], options, resolve, reject, status: 'queued' });
      this.wake();
    });
  }
  async next() {
    while (true) {
      if (this.error) throw this.error;
      const queued = [...this.tasks.values()].filter(task => task.status === 'queued');
      const tools = queued.filter(task => task.stage !== 'write');
      const writes = queued.filter(task => task.stage === 'write');
      if (tools.length) { for (const task of tools) task.status = 'offered'; return { tasks: tools }; }
      if (writes.length) { for (const task of writes) task.status = 'offered'; return { write: writes[0] }; }
      if (this.done) return { value: this.value };
      await new Promise(resolve => this.waiters.add(resolve));
    }
  }
  async execute(id, stage, signal) {
    const task = this.tasks.get(id);
    if (!task || task.stage !== stage || !['offered', 'done'].includes(task.status)) throw new Error('该酒馆工作调用已失效，请重新发送本轮内容');
    if (task.status === 'done') return task.result;
    task.status = 'running';
    try {
      const result = await this.callModel({ ...task.options, signal: AbortSignal.any([this.signal, signal]), onAttempt: record => this.onAttempt?.({ ...record, taskId: id, stage, label: task.label, provider: task.options.agent?.provider, model: task.options.agent?.model }) });
      this.signal.throwIfAborted();
      task.result = result; task.status = 'done'; task.resolve(result); return result;
    } catch (error) { error = runError(error); task.status = 'failed'; task.reject(error); throw error; }
  }
  addUsage(usage) { this.pendingUsage = mergeTokenUsage(this.pendingUsage, usage); }
  takeUsage() {
    const usage = this.pendingUsage ?? emptyUsage();
    this.pendingUsage = null;
    return usage;
  }
  abort(reason = new Error('生成已停止')) { this.controller.abort(reason); }
}
