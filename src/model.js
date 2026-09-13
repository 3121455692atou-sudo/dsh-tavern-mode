import { createMessage, createSystemMessage, LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
import { setTimeout as delay } from 'node:timers/promises';
import { decodeProtocol, ProtocolError } from './contracts.js';

const toMessage = message => message.role === 'system' ? createSystemMessage(message.content, 'dsh-tavern-mode') : createMessage({ role: message.role, source: { kind: 'plugin', plugin: 'dsh-tavern-mode' }, content: [{ type: 'text', text: message.content }] });

export function makeModelCaller(llm) {
  return async ({ agent, messages, schema, signal, onText, onReasoning, onUsage, onAttempt, onChunk, retries = 3, validate }) => {
    if (!agent.provider || !agent.model) throw new Error('请先为 agent 选择提供方和模型');
    let reasoningEffort = agent.reasoningEffort;
    if (!reasoningEffort && agent.presetReasoningEffort) {
      const info = await llm.resolveModelInfo(agent.provider, agent.model, signal);
      if (info.reasoning?.efforts.some(effort => effort.id === agent.presetReasoningEffort)) reasoningEffort = agent.presetReasoningEffort;
    }
    // Structured jobs should not inherit a provider's expensive default
    // thinking mode. Explicit agent/preset settings and writer requests stay intact.
    if (!reasoningEffort && !agent.presetReasoningEffort && schema && llm.resolveModelInfo) {
      const info = await llm.resolveModelInfo(agent.provider, agent.model, signal);
      reasoningEffort = info.reasoning?.efforts?.find(effort => effort.id === 'low')?.id;
    }
    const mode = agent.protocol ?? 'tool';
    const contract = schema ? mode === 'tool'
      ? '本次是结构化任务。必须调用且只调用一次 tavern_result 工具返回最终结果，参数必须符合给定 JSON Schema。'
      : `本次是结构化任务。最终必须输出且只输出一个 <tavern_result>JSON</tavern_result> 协议块。JSON Schema：\n${JSON.stringify(schema)}` : '';
    const retryPolicy = llm.providerRetryPolicy?.(agent.provider) ?? resolveRetryPolicy(undefined, 'tavern.model');
    let correction = '', attempt = 0, transportRetries = 0, requestCount = 0;
    while (true) {
      signal?.throwIfAborted();
      requestCount++;
      const requestMessages = messages.map(toMessage);
      if (contract) requestMessages.push(createSystemMessage(contract + correction, 'dsh-tavern-mode'));
      const options = {
        provider: agent.provider, model: agent.model, messages: requestMessages, signal,
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(agent.temperature != null ? { temperature: agent.temperature } : {}),
        ...(agent.maxTokens != null ? { maxTokens: agent.maxTokens } : {}),
        ...(agent.stop?.length ? { stop: agent.stop } : {}),
        ...(schema && mode === 'tool' ? { tools: [{ name: 'tavern_result', description: '返回本次结构化任务结果', parameters: schema }] } : {}),
      };
      const response = { text: '', toolCalls: [], finish: null };
      const blocks = new Map();
      const report = async (status, kind, error) => {
        response.toolCalls = [...blocks.values()].filter(block => block.type === 'tool-call');
        await onAttempt?.({ attempt: requestCount, status, kind, createdAt: new Date().toISOString(), protocolRetries: retries, ...(error ? { error: { message: error.message, code: error.code ?? error.name } } : {}), response: structuredClone(response) });
      };
      try {
        for await (const chunk of llm.stream(options)) {
          onChunk?.(chunk);
          if (chunk.type === 'text-delta') { response.text += chunk.text; onText?.(chunk.text); }
          else if (chunk.type === 'block-end') blocks.set(chunk.index, chunk.block);
          else if (chunk.type === 'usage') onUsage?.(chunk.usage);
          else if (chunk.type === 'finish') response.finish = chunk.reason;
        }
        if (signal?.aborted) throw signal.reason ?? new Error('生成已取消');
        if (!response.finish) throw new Error('模型流未正常结束');
        if (response.finish.kind === 'error' || response.finish.kind === 'aborted') {
          const failure = response.finish.failure;
          throw new LlmError(failure.message, failure.code, failure);
        }
        response.toolCalls = [...blocks.values()].filter(block => block.type === 'tool-call');
        if (!response.text) response.text = [...blocks.values()].filter(block => block.type === 'text').map(block => block.text).join('');
        if (!schema && !response.toolCalls.length && !response.text.trim()) throw new LlmError('写作模型返回了空正文', 'EMPTY_RESPONSE');
      } catch (error) {
        const retryable = retryPolicy.mode === 'always' || (retryPolicy.retryableCodes.includes(error.code) && transportRetries < retryPolicy.maxRetries);
        if (!schema && response.text.length || signal?.aborted || response.finish?.kind === 'aborted' || !retryable) { await report('failed', 'transport', error); throw error; }
        await report('retrying', 'transport', error);
        const backoff = retryPolicy.initialDelayMs * 2 ** transportRetries++;
        const wait = Math.min(retryPolicy.maxDelayMs, error.failure?.providerRetryAfterMs ?? backoff * (1 + (Math.random() * 2 - 1) * retryPolicy.jitterRatio));
        await delay(Math.max(0, Math.round(wait)), undefined, { signal });
        continue;
      }
      if (!schema) {
        if (response.toolCalls.length) {
          const error = new Error('写作模型返回了工具调用，没有形成正文');
          await report('failed', 'protocol', error); throw error;
        }
        const reasoning = [...blocks.values()].filter(block => block.type === 'reasoning').map(block => block.text).join('');
        if (reasoning) onReasoning?.(reasoning);
        if (requestCount > 1) await report('succeeded', 'response');
        return response.text;
      }
      let value;
      try { value = decodeProtocol(response, schema, mode); await validate?.(value); }
      catch (error) {
        if (!(error instanceof ProtocolError) || attempt === retries) { await report('failed', 'protocol', error); throw error; }
        await report('retrying', 'protocol', error);
        attempt++;
        const rejected = value ?? (mode === 'tool' ? response.toolCalls.map(({ name, arguments: args }) => ({ name, arguments: args })) : response.text);
        correction = `\n上次结果未通过协议校验：${error.message}\n上次结果：${JSON.stringify(rejected)}\n请纠正全部错误并返回完整有效的结构化结果。`;
        continue;
      }
      if (requestCount > 1) await report('succeeded', 'response');
      return value;
    }
  };
}
