// Native streaming messages can arrive before the Tavern revision containing
// them. Never match two missing ids or borrow an unrelated helper draft.
export function findMessageIndex(state, nativeId, text, role) {
  const index = nativeId ? state.messages.findIndex(message => message.nativeMessageId === nativeId) : -1;
  return index >= 0 ? index : state.messages.findLastIndex(message => message.role === role && message.content === text);
}

export function displayMessage(state, message, fallback = '') {
  const helper = message?.id ? state.helperChat?.find(item => item.tavernMessageId === message.id) : undefined;
  return { text: helper?.mes ?? message?.content ?? fallback, hidden: helper?.is_system ?? message?.is_hidden ?? false };
}
