import { createHash } from 'node:crypto';
const hash = value => createHash('sha256').update(value).digest('hex');
export function createRequestAuditor() {
  // Bounded, process-local diagnostic history, not a response or provider cache.
  const previous = new Map();
  let retainedCharacters = 0;
  return (messages, schema, route = {}) => {
    const schemaText = JSON.stringify(schema ?? null);
    const text = JSON.stringify(messages.map(({ role, content }) => ({ role, content })));
    const lane = JSON.stringify([route.sessionId, route.provider, route.model, route.stage, route.label, hash(schemaText), route.mode]);
    const before = previous.get(lane) ?? '';
    let common = 0;
    while (common < before.length && common < text.length && before[common] === text[common]) common++;
    retainedCharacters -= before.length;
    previous.delete(lane); const retained = text.slice(0, 200000);
    previous.set(lane, retained); retainedCharacters += retained.length;
    while (previous.size > 128 || retainedCharacters > 4_000_000) {
      const oldest = previous.keys().next().value; retainedCharacters -= previous.get(oldest).length; previous.delete(oldest);
    }
    return { kind: 'local-input-audit-not-provider-cache', layer: 'before-sdk-conversion', comparedWithPrevious: before.length > 0, inputCharacters: messages.reduce((n, m) => n + m.content.length, 0),
      serializedBytes: Buffer.byteLength(text), schemaCharacters: schemaText.length, schemaHash: hash(schemaText), messageHash: hash(text),
      sharedPrefixCharacters: common, comparisonLimitCharacters: 200000,
      messages: messages.map(({ role, content }) => ({ role, characters: content.length, hash: hash(content) })) };
  };
}
