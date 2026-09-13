import { NativeRun } from './native-run.js';
import { makeModelCaller } from './model.js';
import { stageLabels } from './defaults.js';

export const name = 'tavern-agent';
export const inject = ['tavernMode', 'llm', 'tools', 'agents', 'sessionProjections'];

export function apply(ctx) {
  const runs = new Map(), boundaries = new Map();
  const callModel = makeModelCaller(ctx.llm);
  const isTavern = agent => agent && ctx.sessionProjections.stateOf(agent.session, 'agentPreset') === 'tavern';
  for (const [stage, label] of Object.entries(stageLabels)) {
    ctx.tools.register({
      name: `tavern_${stage}`,
      description: label,
      parameters: { type: 'object', additionalProperties: false, properties: { taskId: { type: 'string' }, label: { type: 'string' }, provider: { type: 'string' }, model: { type: 'string' } }, required: ['taskId', 'label', 'provider', 'model'] },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        if (!isTavern(exec.agent)) throw new Error('该工具仅用于酒馆模式');
        const run = runs.get(exec.agent.id);
        if (!run) throw new Error('上一轮酒馆工作已中断，请重新发送本轮内容');
        const value = await run.execute(args.taskId, stage, exec.signal);
        return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      },
    });
  }
  ctx.on('agent/pre-step', async (payload, next) => {
    if (isTavern(payload.agent)) {
      const previous = boundaries.get(payload.agent.id);
      const messages = previous?.turn === payload.turn ? [...previous.messages, ...payload.messages] : [...payload.messages];
      if (runs.has(payload.agent.id) && (previous?.turn !== payload.turn || payload.messages.length)) {
        const run = runs.get(payload.agent.id);
        run.abort(new Error(previous?.turn === payload.turn ? '用户补充了本轮输入' : '开始下一轮'));
        await run.completion;
        runs.delete(payload.agent.id);
      }
      boundaries.set(payload.agent.id, { ...payload, messages });
    }
    return next();
  });
  ctx.on('llm/stream', async function* (options, next) {
    const agent = options.sessionId && ctx.agents.get(options.sessionId);
    if (!agent || options.purpose || !isTavern(agent)) { yield* next(); return; }
    const boundary = boundaries.get(agent.id);
    if (!boundary) throw new Error('酒馆模式未收到本轮输入');
    let run = runs.get(agent.id);
    if (!run) {
      run = new NativeRun({ signal: boundary.signal, callModel, onAttempt: record => ctx.tavernMode.recordModelAttempt?.(agent.id, record), work: (dispatch, signal) => ctx.tavernMode.run({ agent, messages: boundary.messages, route: options, callModel: dispatch, signal, turn: boundary.turn, writeBoundary: () => ({ step: run.writeStep, text: run.writeText }) }) });
      run.turn = boundary.turn;
      runs.set(agent.id, run);
    }
    function* emitTools(tasks, start = 0) {
      for (const [offset, task] of tasks.entries()) {
        const index = start + offset, name = `tavern_${task.stage}`;
        const args = JSON.stringify({ label: task.label, provider: task.options.agent.provider, model: task.options.agent.model, taskId: task.id });
        yield { type: 'block-start', index, blockType: 'tool-call' };
        yield { type: 'tool-call-delta', index, id: task.id, name, argumentsDelta: args };
        yield { type: 'block-end', index, block: { type: 'tool-call', id: task.id, name, arguments: args } };
      }
    }
    function* emitFinish(kind) {
      yield { type: 'usage', usage: run.takeUsage() };
      yield { type: 'finish', reason: { kind } };
    }
    let result;
    try { result = await run.next(); }
    catch (error) {
      // Failed calls were previously dropped when next() threw before finish.
      yield { type: 'usage', usage: run.takeUsage() };
      throw error;
    }
    if (result.tasks) {
      yield* emitTools(result.tasks);
      yield* emitFinish('tool-calls');
      return;
    }
    if (result.write) {
      const task = result.write;
      run.writeStep = boundary.step;
      const queue = [];
      let wake;
      const push = item => { queue.push(item); wake?.(); };
      task.status = 'running';
      run.callModel({
        ...task.options,
        signal: AbortSignal.any([run.signal, boundary.signal].filter(Boolean)),
        onChunk: chunk => push(chunk),
        onAttempt: record => ctx.tavernMode.recordModelAttempt?.(agent.id, { ...record, taskId: task.id, stage: task.stage, label: task.label, provider: task.options.agent?.provider, model: task.options.agent?.model }),
      }).then(value => push({ done: true, value }), error => push({ error }));
      let reasoningIndex = -1, textIndex = -1, nextIndex = 0, reasoning = '', text = '';
      const emittedReasoning = new Set();
      const closeReasoning = function* () {
        if (reasoningIndex >= 0) { yield { type: 'block-end', index: reasoningIndex, block: { type: 'reasoning', text: reasoning } }; reasoningIndex = -2; }
      };
      while (true) {
        if (!queue.length) await new Promise(resolve => { wake = resolve; });
        const item = queue.shift();
        if (item.error) { task.status = 'failed'; task.reject(item.error); run.abort(item.error); throw item.error; }
        if (item.done) { task.result = item.value; run.writeText = String(item.value ?? ''); task.status = 'done'; task.resolve(item.value); break; }
        if (item.type === 'reasoning-delta') {
          emittedReasoning.add(item.index);
          if (reasoningIndex < 0) { reasoning = ''; reasoningIndex = nextIndex++; yield { type: 'block-start', index: reasoningIndex, blockType: 'reasoning' }; }
          reasoning += item.text; yield { type: 'reasoning-delta', index: reasoningIndex, text: item.text };
        } else if (item.type === 'text-delta') {
          yield* closeReasoning();
          if (textIndex < 0) { textIndex = nextIndex++; yield { type: 'block-start', index: textIndex, blockType: 'text' }; }
          text += item.text; yield { type: 'text-delta', index: textIndex, text: item.text };
        } else if (item.type === 'block-end' && item.block?.type === 'reasoning' && !emittedReasoning.has(item.index) && item.block.text) {
          yield* closeReasoning();
          emittedReasoning.add(item.index);
          reasoningIndex = nextIndex++; reasoning = item.block.text;
          yield { type: 'block-start', index: reasoningIndex, blockType: 'reasoning' };
          yield { type: 'reasoning-delta', index: reasoningIndex, text: reasoning };
        }
      }
      yield* closeReasoning();
      if (textIndex >= 0) yield { type: 'block-end', index: textIndex, block: { type: 'text', text: text || String(task.result ?? '') } };
      else {
        const body = String(task.result ?? '');
        yield { type: 'block-start', index: nextIndex, blockType: 'text' };
        yield { type: 'text-delta', index: nextIndex, text: body };
        yield { type: 'block-end', index: nextIndex, block: { type: 'text', text: body } };
        nextIndex++;
      }
      const more = await run.next();
      if (more.tasks) {
        yield* emitTools(more.tasks, nextIndex);
        yield* emitFinish('tool-calls');
        return;
      }
      await ctx.tavernMode.stageFinal(agent, more.value, boundary.turn, run.writeStep, run.writeText);
      yield* emitFinish('stop');
      return;
    }
    if (result.value.updatesOnly) { yield* emitFinish('stop'); return; }
    await ctx.tavernMode.stageFinal(agent, result.value, boundary.turn, run.writeStep ?? boundary.step, run.writeText);
    if (run.writeStep !== undefined) { yield* emitFinish('stop'); return; }
    const text = result.value.messages.at(-1).content;
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield* emitFinish('stop');
  });
  ctx.on('agent/turn-stopping', async ({ agent }) => {
    if (!isTavern(agent)) return;
    await ctx.tavernMode.commit(agent);
    runs.delete(agent.id);
  });
  ctx.on('tools/result', (exec, result) => {
    if (exec.agent && exec.name.startsWith('tavern_') && result.isError) {
      const run = runs.get(exec.agent.id);
      // execute() has already rejected this task into the pipeline, which will
      // await independent siblings before ending the turn. External dispatch
      // errors still need to wake a pipeline whose task was never executed.
      if (run && ![...run.tasks.values()].some(task => task.status === 'failed')) run.abort(new Error(result.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') || '酒馆工具调用失败'));
    }
  });
  ctx.on('agent/error', ({ agent, error }) => { runs.get(agent.id)?.abort(error); runs.delete(agent.id); ctx.tavernMode.abort(agent.id); });
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/end' && runs.has(session.id)) { runs.get(session.id).abort(); runs.delete(session.id); ctx.tavernMode.abort(session.id); }
  });
  ctx.on('agent/disposed', ({ agent }) => { runs.get(agent.id)?.abort(); runs.delete(agent.id); boundaries.delete(agent.id); if (isTavern(agent)) ctx.tavernMode.abort(agent.id); });
  ctx.effect(() => () => { for (const run of runs.values()) run.abort(new Error('酒馆插件已停止')); });
}
