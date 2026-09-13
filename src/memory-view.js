import { factView, episodeView, recallView } from './prompt-context.js';

// Resolve only explicitly linked and authorized events for a character's
// private retrieval lane. Missing links must never grant additional knowledge.
export function memoryEpisodes(state, characterId) {
  const events = new Map((state.memoryEvents ?? []).map(event => [event.id, event]));
  return (state.memories[characterId] ?? []).map(record => {
    if (!record.eventIds) return record;
    const visible = record.eventIds.map(id => events.get(id)).filter(event => event?.knownByCharacterIds.includes(characterId));
    return { ...record, events: visible, summary: visible.map(event => event.summary).join('\n') };
  });
}

// Downstream agents receive each selected shared event once, followed by each
// character's references. Legacy archives remain readable without migration.
export function recallBundle(recalls) {
  const events = new Map();
  const characters = recalls.map(recall => {
    const view = recallView(recall);
    view.records = (recall.records ?? []).map(record => {
      if (!record.eventIds) return episodeView(record);
      const ids = [];
      for (const event of record.events ?? []) if (event.knownByCharacterIds.includes(recall.characterId)) {
        events.set(event.id, { id: event.id, summary: event.summary, knownByCharacterIds: event.knownByCharacterIds }); ids.push(event.id);
      }
      return { eventIds: ids, ...(record.stateChanges?.length ? { stateChanges: record.stateChanges.map(change => factView(change)) } : {}) };
    });
    return view;
  });
  return { events: [...events.values()], characters };
}

