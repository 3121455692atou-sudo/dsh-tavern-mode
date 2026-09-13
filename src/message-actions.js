import { ensureTableHistory, removeTableSources } from './table-history.js';
const nativeContent = event => event.type === 'user/message' ? event.data : event.type === 'assistant/message' ? event.data.message : undefined;
const textOf = message => message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');

export function messageHistory(state, events) {
  const native = new Map(events.filter(event => nativeContent(event)).map(event => [nativeContent(event).id, event]));
  const represented = new Set(state.messages.map(message => message.nativeMessageId));
  const entries = state.messages.map((message, index) => ({ ...message, seq: native.get(message.nativeMessageId)?.seq ?? (state.messages.slice(index + 1).map(next => native.get(next.nativeMessageId)?.seq).find(seq => seq !== undefined) ?? (events.at(-1)?.seq ?? 0) + 1) - 1 + index / Math.max(1, state.messages.length) }));
  for (const [id, event] of native) {
    if (represented.has(id) || state.deletedNativeMessageIds?.includes(id) || state.hiddenNativeRanges?.some(([start, end]) => event.seq >= start && event.seq < end)) continue;
    if (event.type !== 'user/message' || event.data.source?.kind && event.data.source.kind !== 'user') continue;
    const content = state.nativeMessageOverrides?.[id] ?? textOf(nativeContent(event));
    entries.push({ nativeMessageId: id, role: 'user', content, seq: event.seq });
  }
  return entries.sort((a, b) => a.seq - b.seq);
}

export function invalidateMessageMemories(state, ids) {
  removeTableSources(state, ids);
  const removed = new Set(ids);
  for (const id of Object.keys(state.memories)) state.memories[id] = state.memories[id].filter(memory => !memory.sourceMessageIds?.some(id => removed.has(id)));
  state.worldHistory = (state.worldHistory ?? []).filter(episode => !episode.sourceMessageIds?.some(id => removed.has(id)));
}

export function deleteMessages(state, ids) {
  if (!Array.isArray(ids) || ids.some(id => !state.messages.some(message => message.id === id))) throw new Error('要删除的消息不存在');
  const removed = new Set(ids), retained = state.messages.flatMap((message, index) => removed.has(message.id) ? [] : [{ message, variables: state.messageVariables?.[index] }]);
  state.deletedNativeMessageIds = [...new Set([...(state.deletedNativeMessageIds ?? []), ...state.messages.filter(message => removed.has(message.id) && message.nativeMessageId).map(message => message.nativeMessageId)])];
  state.messages = retained.map(value => value.message);
  state.messageVariables = Object.fromEntries(retained.map((value, index) => [index, value.variables ?? [{}]]));
  state.helperChat = (state.helperChat ?? []).filter(message => !removed.has(message.tavernMessageId));
  invalidateMessageMemories(state, ids);
}

export async function messageAction(store, state, events, request) {
  await ensureTableHistory(store, state);
  const message = state.messages.find(message => request.messageId ? message.id === request.messageId : message.nativeMessageId === request.nativeMessageId);
  const nativeId = message?.nativeMessageId ?? request.nativeMessageId;
  const event = events.find(event => nativeId && nativeContent(event)?.id === nativeId);
  if (!message && !event) throw new Error('消息不存在，请刷新后重试');
  if (request.action === 'edit') {
    if (typeof request.text !== 'string') throw new Error('消息内容无效');
    const helper = message && state.helperChat?.find(item => item.tavernMessageId === message.id);
    const current = helper?.mes ?? message?.content ?? state.nativeMessageOverrides?.[nativeId] ?? textOf(nativeContent(event));
    if (request.text === current) return { state };
    if (nativeId) (state.nativeMessageOverrides ??= {})[nativeId] = request.text;
    if (message) {
      message.content = request.text;
      if (helper) {
        helper.mes = request.text;
        if (helper.swipes) helper.swipes[helper.swipe_id ?? 0] = request.text;
      }
      invalidateMessageMemories(state, [message.id]);
    }
    return { state };
  }
  if (request.action === 'delete') {
    if (message) deleteMessages(state, [message.id]);
    else state.deletedNativeMessageIds = [...new Set([...(state.deletedNativeMessageIds ?? []), nativeId])];
    return { state };
  }
  if (request.action !== 'reroll' && request.action !== 'rewrite') throw new Error('未知消息操作');
  if (message?.greeting || !event) throw new Error('该消息没有可重新生成的用户输入');
  const start = events.findLast(item => item.type === 'turn/start' && item.seq <= event.seq)?.seq;
  if (start === undefined) throw new Error('未找到本轮开始位置');
  const inputEvent = event.type === 'user/message' ? event : events.findLast(item => item.type === 'user/message' && item.seq >= start && item.seq < event.seq);
  if (!inputEvent) throw new Error('未找到本轮用户输入');
  const inputId = nativeContent(inputEvent).id;
  const input = state.messages.find(item => item.nativeMessageId === inputId);
  const helper = input && state.helperChat?.find(item => item.tavernMessageId === input.id);
  const text = request.text ?? helper?.mes ?? input?.content ?? state.nativeMessageOverrides?.[inputId] ?? textOf(nativeContent(inputEvent));
  if (typeof text !== 'string' || !text.trim()) throw new Error('请输入重新生成所需的内容');
  if (request.action === 'rewrite' && !(state.lastRun?.combination && state.lastRun?.plan && state.lastRun?.recalls)) throw new Error('没有可复用的推进结果，请全部重新生成');
  let baseline = state;
  while (input ? baseline.messages.some(item => item.id === input.id) : baseline.nativeAnchorSeq >= start) {
    if (!baseline.previousRevision) throw new Error('未找到本轮之前的剧情状态');
    baseline = await store.session(state.id, baseline.previousRevision);
  }
  const current = new Map(state.messages.map(message => [message.id, message]));
  await ensureTableHistory(store, baseline);
  const restored = { ...baseline, revision: state.revision, nativeMessageOverrides: state.nativeMessageOverrides, deletedNativeMessageIds: state.deletedNativeMessageIds,
    hiddenNativeRanges: [...(state.hiddenNativeRanges ?? []), [start, (events.at(-1)?.seq ?? start) + 1]],
  };
  for (const key of ['config', 'title', 'userName', 'persona', 'presetId', 'toolPresetId', 'presetOverride', 'legacyId', 'bubbleId', 'renderMode', 'worldbookIds', 'worldbookOverrides', 'regexIds', 'regexOrder']) if (Object.hasOwn(state, key)) restored[key] = state[key];
  const retained = baseline.messages.flatMap((message, index) => current.has(message.id) ? [{ message, variables: baseline.messageVariables?.[index] }] : []);
  restored.messages = retained.map(({ message }) => ({ ...message, content: current.get(message.id).content }));
  restored.messageVariables = Object.fromEntries(retained.map(({ variables }, index) => [index, variables ?? [{}]]));
  invalidateMessageMemories(restored, baseline.messages.filter(message => !current.has(message.id) || current.get(message.id).content !== message.content).map(message => message.id));
  const ids = new Set(restored.messages.map(message => message.id));
  restored.helperChat = (state.helperChat ?? []).filter(message => ids.has(message.tavernMessageId));
  if (request.action === 'rewrite') restored.rewrite = { combination: state.lastRun.combination, plan: state.lastRun.plan, recalls: state.lastRun.recalls, advance: state.lastRun.advance };
  return { state: restored, text };
}
