import { readTurnCheckpoint } from './turn-checkpoint.js';

export const RESUME_COMMAND = '/tavern-resume';
const textOf = message => (message?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
const isControl = text => text.startsWith(RESUME_COMMAND) || text === '/tavern-retry-updates';

function nativeRequest(events) {
  // Retry controls are transport messages, not additional story input. Include
  // every original user message from the failed turn, including additions.
  const last = events.findLastIndex(event => event.type === 'user/message' && !isControl(textOf(event.data)));
  if (last < 0) return null;
  let start = last; while (start > 0 && events[start].type !== 'turn/start') start--;
  const messages = events.slice(start, last + 1).filter(event => event.type === 'user/message').map(event => event.data).filter(message => !isControl(textOf(message)));
  return { text: messages.map(textOf).filter(Boolean).join('\n\n'), nativeMessageId: messages.at(-1)?.id };
}

function nativeFailures(events) {
  const lastFailure = events.findLastIndex(event => event.type === 'tool/result' && event.data?.message?.content?.some(block => block.type === 'tool-result' && block.isError));
  if (lastFailure < 0) return [];
  let start = lastFailure; while (start > 0 && events[start].type !== 'turn/start') start--;
  const turn = events.slice(start, lastFailure + 1);
  return turn.filter(event => event.type === 'tool/result').flatMap(event => event.data.message.content.filter(block => block.type === 'tool-result' && block.isError).map(block => {
    const call = turn.find(event => event.type === 'tool/call' && event.data.callId === block.toolCallId)?.data;
    let args; try { args = JSON.parse(call?.arguments ?? '{}'); } catch { args = {}; }
    return { stage: call?.name?.replace(/^tavern_/, ''), label: args.label ?? '失败步骤', message: textOf(block).replace(/^Error: /, '') };
  }));
}

export async function turnRecovery(store, state, session) {
  const checkpoint = await readTurnCheckpoint(store, state.id);
  const events = session?.snapshotEvents?.() ?? [];
  const pending = state.pendingUpdates;
  const failures = Object.values(pending?.failures ?? checkpoint?.failures ?? {});
  if (!failures.length) failures.push(...nativeFailures(events));
  if (pending) return { kind: 'updates', token: pending.context.turnId, label: failures.map(f => f.label).join('、') || '表格与记忆更新', completedSteps: Object.keys(pending.results ?? {}).length, error: pending.error, failures };
  if (!checkpoint) return null;
  const request = checkpoint.request ?? nativeRequest(events);
  if (!request?.text || !request.nativeMessageId) return null;
  return { kind: 'turn', token: checkpoint.identity.seed, label: failures.map(f => f.label).join('、') || '未完成步骤', completedSteps: Object.keys(checkpoint.results).length, error: failures[0]?.message, failures, request };
}

export const publicRecovery = recovery => recovery && Object.fromEntries(Object.entries(recovery).filter(([key]) => key !== 'request'));
