import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { ProtocolError } from './contracts.js';
import { factKey } from './memory-state.js';
export { currentFacts, effectiveMessages } from './memory-state.js';

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
const terms = value => [...segmenter.segment(String(value).normalize('NFKC').toLowerCase())].filter(part => part.isWordLike).map(part => part.segment);

export function evidenceSources(messages) {
  const sources = [];
  for (const message of messages) for (const quote of (message.role === 'assistant'
    ? message.content.replace(/<think\b[^>]*>[\s\S]*?(?:<\/think>|$)/gi, '\n') : message.content).split(/\r?\n/)) {
    if (quote.trim()) sources.push({ id: `source-${sources.length + 1}`, messageId: message.id, quote });
  }
  return sources;
}

export function resolveEvidence(reference, sources) {
  const source = sources.find(source => source.id === reference.sourceId);
  if (!source) throw new ProtocolError(`依据 sourceId ${JSON.stringify(reference.sourceId)} 不存在；可用 id：${JSON.stringify(sources.map(source => source.id))}`);
  return { messageId: source.messageId, quote: source.quote };
}

export function resolveStateChanges(changes, current, sources) {
  return changes.map(({ op, target, value, evidence }) => {
    // The exact subject/key already identifies an existing attribute in this
    // character's state. Resolve it locally, as an UPDATE, without paying for
    // another model call solely to copy its opaque id. Unknown explicit ids
    // remain invalid and evidence/duplicate-update validation is unchanged.
    const previous = target.id === undefined ? current.find(fact => fact.subject === target.subject && fact.key === target.key) : current.find(fact => fact.id === target.id);
    if (target.id !== undefined && !previous) throw new ProtocolError(`状态 target.id ${JSON.stringify(target.id)} 不是当前状态记录；请从 currentState/currentWorldState 中选择现有 id`);
    const { subject, key } = previous ?? target;
    return { op, subject, key, value, previousFactId: previous?.id ?? null, evidence: resolveEvidence(evidence, sources) };
  });
}

export function validateEvidence(evidence, messages) {
  const source = messages.find(message => message.id === evidence.messageId)?.content;
  if (source === undefined) throw new ProtocolError(`依据 messageId ${JSON.stringify(evidence.messageId)} 不属于本轮；可用 id：${JSON.stringify(messages.map(message => message.id))}`);
  if (!evidence.quote.trim() || !source.includes(evidence.quote)) throw new ProtocolError(`依据 quote ${JSON.stringify(evidence.quote)} 不是消息 ${evidence.messageId} 中的原文片段，请从该消息 content 复制连续原文，保留标点`);
}

export function memoryCandidates(memories, queries, limit) {
  if (memories.length <= limit) return [...memories];
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE VIRTUAL TABLE archive USING fts5(content, tokenize="unicode61")');
    const insert = db.prepare('INSERT INTO archive(rowid, content) VALUES (?, ?)');
    db.exec('BEGIN');
    for (const [index, memory] of memories.entries()) insert.run(index + 1, terms(JSON.stringify({ summary: memory.summary, facts: memory.facts, relationships: memory.relationships, openThreads: memory.openThreads, stateChanges: memory.stateChanges, subject: memory.subject, key: memory.key, value: memory.value })).join(' '));
    db.exec('COMMIT');
    const query = [...new Set(queries.flatMap(terms))].map(term => '"' + term.replaceAll('"', '""') + '"').join(' OR ');
    const ranked = query ? db.prepare('SELECT rowid FROM archive WHERE archive MATCH ? ORDER BY bm25(archive), rowid DESC LIMIT ?').all(query, limit).map(row => memories[Number(row.rowid) - 1]) : [];
    const recentCount = Math.max(1, Math.min(8, Math.floor(limit / 4)));
    const selected = [...ranked.slice(0, limit - recentCount), ...memories.slice(-recentCount).reverse(), ...ranked, ...memories.slice(-limit).reverse()];
    return [...new Map(selected.map(memory => [memory.id, memory])).values()].slice(0, limit);
  } finally { db.close(); }
}

export function validateStateChanges(changes, current, messages) {
  const facts = new Map(current.map(fact => [factKey(fact), fact]));
  const changed = new Set(), errors = [];
  for (const change of changes) {
    const key = factKey(change), previous = facts.get(key);
    if (changed.has(key)) errors.push(`状态 ${change.subject}/${change.key} 在本轮只能更新一次`);
    changed.add(key);
    if (change.previousFactId !== (previous?.id ?? null)) errors.push(`状态 ${change.subject}/${change.key} 的旧记录 id 不匹配；当前记录：${JSON.stringify(previous ?? null)}`);
    if (change.op === 'remove' && (!previous || change.value !== null)) errors.push(`移除 ${change.subject}/${change.key} 必须引用现有记录，value 为 null`);
    if (change.op === 'set' && (typeof change.value !== 'string' || !change.value.trim())) errors.push(`设置 ${change.subject}/${change.key} 需要非空 value`);
    try { validateEvidence(change.evidence, messages); }
    catch (error) { if (!(error instanceof ProtocolError)) throw error; errors.push(`${change.subject}/${change.key}：${error.message}`); }
  }
  if (errors.length) throw new ProtocolError(errors.join('\n'));
}

export function recordStateChanges(changes, turnId, createdAt) {
  return changes.map(change => ({ ...change, id: randomUUID(), turnId, createdAt }));
}
