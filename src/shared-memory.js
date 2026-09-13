import { createHash } from 'node:crypto';
import { object, ProtocolError } from './contracts.js';

const text = { type: 'string' }, texts = { type: 'array', items: text };
export function sharedMemorySchema(memorySchema) {
  return object({
    events: { type: 'array', items: object({ summary: text, knownByCharacterIds: texts, evidence: object({ sourceId: text }) }) },
    characters: { type: 'array', items: object({ characterId: text, stateChanges: memorySchema.properties.stateChanges }) },
  });
}

export const SHARED_MEMORY_INSTRUCTIONS = `本次统一抽取共同经历，并分别维护各角色的知情范围。输入正文只读一遍，不为每个人重写一份摘要、事实表、关系表和悬念表。
events 中每一件已经发生的事情只写一次，summary 保留主体、对象、动作和完成状态；knownByCharacterIds 只列出确实经历、观察或被告知该事实的角色。同场不等于知道所有事；别人的内心、隐瞒的动机、离场后发生的事不能自动共享。只有一人知道的私密事件也放在 events 中，知情者仅填该人。不同知情范围的事实拆成不同事件，不能揉成一段再给所有人。
evidence.sourceId 引用 sourcePassages 中支持该事实的精确段落。纯计划、候选选项、重复的旧事件不记录。
characters 必须恰好覆盖输入角色，每人只返回本轮新的个人状态变化 stateChanges，例如情绪、承诺、关系变化、个人所持物品；没有变化返回空数组。公共事件原文只在 events 中保存，不在每个人的 stateChanges 中复述。已有属性只用 characterStates 中该角色的属性 id 更新；新增用 subject/key。
previousEvents 是已有事件资料，knownByCharacterIds 表示谁已经知道，不能因为此处提供就让其他人知道。不复述既有事件和未变化的状态。只调用一次 tavern_result。`;

export { memoryEpisodes, recallBundle } from './memory-view.js';

export function validateSharedMemory(result, characters, validateChanges, validateSource) {
  const ids = new Set(characters.map(character => character.id));
  if (result.characters.length !== ids.size || new Set(result.characters.map(character => character.characterId)).size !== ids.size) throw new ProtocolError('共同记忆必须逐一覆盖本次角色，不能遗漏或重复');
  for (const character of result.characters) {
    if (!ids.has(character.characterId)) throw new ProtocolError('共同记忆引用了本次以外的角色');
    validateChanges(character);
  }
  for (const event of result.events) {
    if (!event.summary.trim() || !event.knownByCharacterIds.length || new Set(event.knownByCharacterIds).size !== event.knownByCharacterIds.length) throw new ProtocolError('记忆事件需要内容与不重复的知情角色');
    if (event.knownByCharacterIds.some(id => !ids.has(id))) throw new ProtocolError('事件知情范围包含本次以外的角色');
    validateSource(event.evidence);
  }
}

export function recordSharedEvents(result, { state, turnId, createdAt, sourceMessageIds, resolveEvidence }) {
  const events = result.events.map(event => {
    const evidence = resolveEvidence(event.evidence);
    const id = 'event-' + createHash('sha256').update(JSON.stringify([turnId, evidence, event.summary])).digest('hex').slice(0, 32);
    return { ...event, id, turnId, createdAt, sourceMessageIds, evidence };
  });
  const archive = new Map((state.memoryEvents ?? []).map(event => [event.id, event]));
  for (const event of events) {
    const previous = archive.get(event.id);
    archive.set(event.id, previous ? { ...previous, knownByCharacterIds: [...new Set([...previous.knownByCharacterIds, ...event.knownByCharacterIds])] } : event);
  }
  state.memoryEvents = [...archive.values()];
  return result.characters.map(character => ({ ...character, summary: '', facts: [], relationships: [], openThreads: [],
    eventIds: events.filter(event => event.knownByCharacterIds.includes(character.characterId)).map(event => event.id) }));
}
