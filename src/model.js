import { createMessage, createSystemMessage, LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
import { setTimeout as delay } from 'node:timers/promises';
import { decodeProtocol, ProtocolError } from './contracts.js';
import { requiredShape, repairMessages } from './protocol-repair.js';
import { createRequestAuditor } from './request-audit.js';
import { boundedStream } from './model-deadline.js';

const toMessage = message => message.role === 'system' ? createSystemMessage(message.content, 'dsh-tavern-mode') : createMessage({ role: message.role, source: { kind: 'plugin', plugin: 'dsh-tavern-mode' }, content: [{ type: 'text', text: message.content }] });

export function makeModelCaller(llm, { toolIdleMs = 60000 } = {}) {
  const audit = createRequestAuditor();
  return async ({ agent, messages, schema, signal, sessionId, stage, label, repairContext, onRequest, onText, onReasoning, onUsage, onAttempt, onChunk, retries = 3, validate }) => {
    if (!agent.provider || !agent.model) throw new Error('请先为 agent 选择提供方和模型');
    let reasoningEffort = agent.reasoningEffort;
    if (!reasoningEffort && agent.presetReasoningEffort) {
      const info = await llm.resolveModelInfo(agent.provider, agent.model, signal);
      if (info.reasoning?.efforts.some(effort => effort.id === agent.presetReasoningEffort)) reasoningEffort = agent.presetReasoningEffort;
    }
    if (!reasoningEffort && !agent.presetReasoningEffort && schema && llm.resolveModelInfo) {
      const info = await llm.resolveModelInfo(agent.provider, agent.model, signal);
      reasoningEffort = info.reasoning?.efforts?.find(effort => effort.id === 'low')?.id;
    }
    const mode = agent.protocol ?? 'tool';
    const contract = schema ? [
      mode === 'tool' ? '本次是结构化数据任务。只调用一次 tavern_result 返回最终结果。预设中的 XML 标签/正文格式是字段内部格式，不替代本次工具协议。'
        : `本次是结构化数据任务。只输出一个 <tavern_result>JSON</tavern_result> 协议块。JSON Schema：\n${JSON.stringify(schema)}`,
      `所有必填字段的类型结构：${JSON.stringify(requiredShape(schema))}。数组必须是数组；不能省略嵌套必填字段。`,
    ].join('\n') : '';
    const retryPolicy = llm.providerRetryPolicy?.(agent.provider) ?? resolveRetryPolicy(undefined, 'tavern.model');
    // Even provider "always" must have a finite ceiling.
    const transportLimit = Number.isFinite(retryPolicy.maxRetries) ? Math.max(0, retryPolicy.maxRetries) : 3;
    let currentMessages = messages, repairUsed = false, transportRetries = 0, requestCount = 0;
    while (true) {
      signal?.throwIfAborted(); requestCount++;
      const plain = currentMessages.map(({ role, content }) => ({ role, content }));
      if (contract) {
        // The DSH/pi-ai bridge retains only the FIRST system message as system.
        // Put the actual output contract there, not after an imported persona.
        if (plain[0]?.role === 'system') plain[0] = { role: 'system', content: `${contract}\n\n${plain[0].content}` };
        else plain.unshift({ role: 'system', content: contract });
      }
      const requestInfo = { attempt: requestCount, mode: repairUsed ? 'repair' : 'initial', reasoningEffort: reasoningEffort ?? null,
        ...audit(plain, schema, { sessionId, provider: agent.provider, model: agent.model, stage, label, mode: repairUsed ? 'repair' : 'initial' }) };
      onRequest?.(requestInfo);
      const options = {
        provider: agent.provider, model: agent.model, messages: plain.map(toMessage), signal,
        // Never re-enter the outer tavern llm/stream orchestrator when using
        // the same session id for provider cache affinity.
        purpose: 'tavern.model',
        ...(sessionId ? { sessionId } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(agent.temperature != null ? { temperature: agent.temperature } : {}),
        ...(agent.maxTokens != null ? { maxTokens: agent.maxTokens } : {}),
        ...(agent.stop?.length ? { stop: agent.stop } : {}),
        ...(schema && mode === 'tool' ? { tools: [{ name: 'tavern_result', description: '返回本次结构化任务结果', parameters: schema }] } : {}),
      };
      const response = { text: '', toolCalls: [], finish: null };
      const blocks = new Map(), usage = [];
      const startedAt = new Date().toISOString();
      const report = async (status, kind, error, extra = {}) => {
        response.toolCalls = [...blocks.values()].filter(block => block.type === 'tool-call');
        response.reasoning = [...blocks.values()].filter(block => block.type === 'reasoning').map(block => block.text).join('');
        await onAttempt?.({ attempt: requestCount, status, kind, startedAt, elapsedMs: Date.now() - Date.parse(startedAt), createdAt: new Date().toISOString(), protocolRetries: retries,
          request: requestInfo,
          // Exact plugin-to-SDK payload; deliberately excludes provider secrets.
          input: { format: 'dsh-sdk-input-v1', messages: plain, ...(schema ? { schema } : {}),
            agent: { provider: agent.provider, model: agent.model, protocol: mode, reasoningEffort: reasoningEffort ?? null,
              temperature: agent.temperature, maxTokens: agent.maxTokens, stop: agent.stop } },
          usage, ...extra,
          ...(error ? { error: { message: error.message, code: error.code ?? error.name, phase: error.phase } } : {}), response: structuredClone(response) });
      };
      try {
        const stream = boundedStream(options => llm.stream(options), options, { idleMs: toolIdleMs });
        for await (const chunk of stream) {
          onChunk?.(chunk);
          if (chunk.type === 'text-delta') { response.text += chunk.text; onText?.(chunk.text); }
          else if (chunk.type === 'reasoning-delta') { const block = blocks.get(chunk.index) ?? { type: 'reasoning', text: '' }; block.text += chunk.text; blocks.set(chunk.index, block); }
          else if (chunk.type === 'tool-call-delta') { const block = blocks.get(chunk.index) ?? { type: 'tool-call', arguments: '' }; if (chunk.id) block.id = chunk.id; if (chunk.name) block.name = chunk.name; block.arguments += chunk.argumentsDelta ?? ''; blocks.set(chunk.index, block); }
          else if (chunk.type === 'block-end') blocks.set(chunk.index, chunk.block);
          else if (chunk.type === 'usage') { usage.push(chunk.usage); onUsage?.(chunk.usage); }
          else if (chunk.type === 'finish') response.finish = chunk.reason;
        }
        if (signal?.aborted) throw signal.reason ?? new Error('生成已取消');
        if (!response.finish) throw new LlmError('模型流未正常结束', 'STREAM_CLOSED');
        if (response.finish.kind === 'error' || response.finish.kind === 'aborted') {
          const failure = response.finish.failure ?? { message: '模型请求失败', code: 'UNKNOWN' };
          throw new LlmError(failure.message, failure.code, failure);
        }
        response.toolCalls = [...blocks.values()].filter(block => block.type === 'tool-call');
        if (!response.text) response.text = [...blocks.values()].filter(block => block.type === 'text').map(block => block.text).join('');
        if (!schema && !response.toolCalls.length && !response.text.trim()) {
          const reasoning = [...blocks.values()].filter(block => block.type === 'reasoning').map(block => block.text).join('');
          if (reasoning) onReasoning?.(reasoning);
          throw new LlmError(reasoning ? '写作模型仅返回了思考，没有正文；原始思考已保留，可复制后编辑正文或单独重试写作' : '写作模型返回了空正文；可单独重试写作', 'EMPTY_RESPONSE');
        }
      } catch (error) {
        if (!(error instanceof Error)) error = Object.assign(new Error(signal?.aborted ? '生成已停止' : String(error?.message ?? error?.kind ?? error)), { code: signal?.aborted ? 'ABORTED' : error?.code });
        const fatal = ['AUTH', 'QUOTA', 'QUOTA_EXCEEDED', 'UNSUPPORTED_OPTION', 'CONTEXT_WINDOW_EXCEEDED', 'AUTHENTICATION_ERROR', 'AUTHENTICATION_FAILED', 'PERMISSION_DENIED', 'INVALID_API_KEY', 'INVALID_REQUEST', 'BAD_REQUEST', 'MODEL_NOT_FOUND', 'CONTEXT_LENGTH_EXCEEDED'].includes(error.code) || [400, 401, 403, 404, 413].includes(error.failure?.status ?? error.failure?.statusCode);
        // A completed empty answer is not a transport failure. Replaying the
        // entire writer prompt here used to charge another full request.
        const retryable = !fatal && !['EMPTY_RESPONSE', 'TAVERN_TIMEOUT'].includes(error.code)
          && (!schema || Date.now() - Date.parse(startedAt) < toolIdleMs)
          && transportRetries < transportLimit && (retryPolicy.mode === 'always' || retryPolicy.retryableCodes.includes(error.code));
        if ((!schema && response.text.length) || signal?.aborted || response.finish?.kind === 'aborted' || !retryable) { await report('failed', 'transport', error); throw error; }
        await report('retrying', 'transport', error);
        const backoff = retryPolicy.initialDelayMs * 2 ** transportRetries++;
        const wait = Math.min(retryPolicy.maxDelayMs, error.failure?.providerRetryAfterMs ?? backoff * (1 + (Math.random() * 2 - 1) * retryPolicy.jitterRatio));
        await delay(Math.max(0, Math.round(wait)), undefined, { signal }); continue;
      }
      if (!schema) {
        if (response.toolCalls.length) { const error = new Error('写作模型返回了工具调用，没有形成正文'); await report('failed', 'protocol', error); throw error; }
        const reasoning = [...blocks.values()].filter(block => block.type === 'reasoning').map(block => block.text).join('');
        if (reasoning) onReasoning?.(reasoning);
        await report('succeeded', 'response'); return response.text;
      }
      let value, normalization;
      try {
        if (['length', 'max-tokens', 'max_tokens', 'maxTokens'].includes(response.finish.kind)) {
          const error = new ProtocolError(`模型耗尽输出额度（${usage.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0)} token），结构化结果未完成；原始回复已保留`);
          error.phase = 'truncated'; throw error;
        }
        if (['refusal', 'content_filter', 'safety'].includes(response.finish.kind)) {
          const error = new ProtocolError('模型拒绝了请求；已停止自动重试，请查看原始响应'); error.phase = 'unstructured'; throw error;
        }
        value = decodeProtocol(response, schema, mode, details => { normalization = details; });
        await validate?.(value);
      } catch (error) {
        const raw = response.toolCalls.length === 1 && response.toolCalls[0].name === 'tavern_result' ? response.toolCalls[0].arguments : undefined;
        const candidate = value ?? error.candidate ?? (raw !== undefined ? { rawArguments: raw } : undefined);
        const truncated = ['length', 'max-tokens', 'max_tokens', 'maxTokens'].includes(response.finish.kind);
        // No blind regeneration of ordinary prose, refusal, semantic errors with
        // no grounding, or a truncated result at the same output limit.
        const canRepair = error instanceof ProtocolError && retries > 0 && !repairUsed && !truncated
          && error.phase !== 'unstructured' && candidate !== undefined
          && (error.phase === 'schema' || error.phase === 'decode' || repairContext !== undefined);
        if (!canRepair) { await report('failed', 'protocol', error); throw error; }
        await report('retrying', 'protocol', error);
        currentMessages = repairMessages({ candidate, error, context: repairContext });
        repairUsed = true; continue;
      }
      await report('succeeded', normalization ? 'normalized' : 'response', undefined, normalization ? { normalization } : {});
      return value;
    }
  };
}
