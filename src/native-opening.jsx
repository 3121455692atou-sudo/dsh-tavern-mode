import React from 'react';

// Native `blank` also changes on configuration/runtime events. The imported
// greeting belongs to the Tavern history and must survive those events.
export function createOpening(renderMessage) {
  return function Opening({ sessionId, payload, greetingOnly }) {
    const messages = payload.state.messages;
    if (greetingOnly) return messages[0]?.greeting ? <div className="tavern-opening tavern-greeting">{renderMessage(messages[0], payload, 0, sessionId)}</div> : null;
    let start = messages.length;
    while (start > 0 && messages[start - 1].scriptCreated) start--;
    if (start === messages.length) return null;
    return <div className="tavern-opening">{messages.slice(start).map((message, offset) => renderMessage(message, payload, start + offset, sessionId))}</div>;
  };
}
