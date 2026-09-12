export function effectiveMessages(state) {
  const edits = new Map((state.helperChat ?? []).map(message => [message.tavernMessageId, message]));
  return state.messages.map(message => ({ ...message, content: edits.get(message.id)?.mes ?? message.content, hidden: edits.get(message.id)?.is_system ?? message.is_hidden ?? false }));
}

export const factKey = fact => JSON.stringify([fact.subject, fact.key]);

export function currentFacts(episodes) {
  const facts = new Map();
  for (const episode of episodes ?? []) for (const change of episode.stateChanges ?? []) {
    if (change.op === 'remove') facts.delete(factKey(change));
    else facts.set(factKey(change), change);
  }
  return [...facts.values()];
}
