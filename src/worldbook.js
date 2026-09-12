import { parseRegex } from './macros.js';

export function normalizeWorldbook(value, prefix = 'card') {
  const entries = Array.isArray(value?.entries) ? value.entries : Object.values(value?.entries ?? {});
  return entries.map((entry, index) => {
    const extensions = { ...entry, ...entry.extensions, position: entry.extensions?.position ?? (entry.position === 'before_char' ? 0 : entry.position === 'after_char' ? 1 : typeof entry.position === 'number' ? entry.position : 0) };
    for (const [legacy, current] of Object.entries({ scanDepth: 'scan_depth', caseSensitive: 'case_sensitive', matchWholeWords: 'match_whole_words', excludeRecursion: 'exclude_recursion', preventRecursion: 'prevent_recursion', delayUntilRecursion: 'delay_until_recursion', groupOverride: 'group_override', groupWeight: 'group_weight' })) extensions[current] ??= extensions[legacy];
    return {
    ...entry,
    id: `${prefix}:${entry.id ?? entry.uid ?? index}`,
    originalId: entry.id ?? entry.uid ?? index,
    world: value?.name ?? prefix,
    keys: entry.keys ?? entry.key ?? [], secondary_keys: entry.secondary_keys ?? entry.keysecondary ?? [],
    enabled: entry.enabled !== false && !entry.disable,
    insertion_order: entry.insertion_order ?? entry.order ?? 100,
    extensions,
    };
  });
}

export function keywordMatches(key, text, entry) {
  if (!key) return false;
  if (entry.use_regex || /^\/.+\/[dgimsuvy]*$/.test(key)) return parseRegex(key).test(text);
  const options = entry.extensions ?? {};
  if (!options.case_sensitive) { key = key.toLocaleLowerCase(); text = text.toLocaleLowerCase(); }
  if (options.match_whole_words) return new RegExp(`(^|[^\\p{L}\\p{N}_])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}_])`, 'u').test(text);
  return text.includes(key);
}

const scanFields = { scanDepth: 'scan_depth', caseSensitive: 'case_sensitive', matchWholeWords: 'match_whole_words', excludeRecursion: 'exclude_recursion', preventRecursion: 'prevent_recursion', delayUntilRecursion: 'delay_until_recursion', groupOverride: 'group_override', groupWeight: 'group_weight' };

export function toWorldInfoEntry(entry) {
  const result = { ...entry, ...entry.extensions, id: entry.id, world: entry.world, uid: entry.originalId, content: entry.content, constant: entry.constant,
    key: entry.keys, keysecondary: entry.secondary_keys, disable: !entry.enabled, order: entry.insertion_order,
    ...Object.fromEntries(Object.entries(scanFields).map(([legacy, current]) => [legacy, entry.extensions[current]])),
  };
  delete result.extensions;
  return result;
}

function fromWorldInfoEntry(entry) {
  return { ...entry, originalId: entry.uid, keys: entry.key, secondary_keys: entry.keysecondary, enabled: !entry.disable, insertion_order: entry.order,
    extensions: { ...entry, ...Object.fromEntries(Object.entries(scanFields).map(([legacy, current]) => [current, entry[legacy]])) },
  };
}

export function activateWorldbook(entries, options) {
  const scan = scanWorldbook(entries, options);
  let step = scan.next();
  while (!step.done) step = scan.next();
  return step.value;
}

export async function activateWorldbookWithEvents(entries, options, emit) {
  const scan = scanWorldbook(entries, options);
  let step = scan.next();
  while (!step.done) {
    await emit(step.value.name, step.value.data);
    step = scan.next();
  }
  return step.value;
}

function* scanWorldbook(entries, { messages, turn = 0, history = {}, forcedIds = [], settings = {}, scanDepth = settings.scan_depth ?? 4, random = Math.random, trigger = 'normal' }) {
  const lores = { globalLore: [], characterLore: [], chatLore: [], personaLore: [] };
  for (const entry of structuredClone(entries)) lores[entry.id.startsWith('card:') ? 'characterLore' : 'globalLore'].push(toWorldInfoEntry(entry));
  yield { name: 'worldinfo_entries_loaded', data: lores };
  entries = [...lores.characterLore, ...lores.globalLore, ...lores.chatLore, ...lores.personaLore];
  const selected = new Map();
  const states = structuredClone(history);
  const forced = new Set(forcedIds);
  let recursion = '';
  const sorted = [...entries].sort((a, b) => b.order - a.order);
  const passes = settings.recursive === false ? 0 : settings.max_recursion_steps > 0 ? settings.max_recursion_steps : entries.length;
  let scanState = 1;
  const recursionDelay = { availableLevels: [...new Set(entries.map(entry => Number(entry.delayUntilRecursion ?? 0)).filter(Boolean))].sort((a, b) => a - b), currentLevel: 0 };
  const budget = { current: Infinity, overflowed: false };
  for (let pass = 0; pass <= passes; pass++) {
    const candidates = [];
    for (const entry of sorted) {
      const normalized = fromWorldInfoEntry(entry), x = normalized.extensions;
      const key = `${entry.world}.${entry.uid}`;
      if (entry.disable || selected.has(key) || !entry.content.trim()) continue;
      if (x.triggers?.length && !x.triggers.includes(trigger)) continue;
      if (Number(x.delay ?? 0) > turn) continue;
      const last = states[entry.id];
      const sticky = last !== undefined && Number(x.sticky ?? 0) > 0 && turn - last < Number(x.sticky);
      if (!sticky && last !== undefined && Number(x.cooldown ?? 0) > 0 && turn - last < Number(x.cooldown) + Number(x.sticky ?? 0)) continue;
      if (pass > 0 && x.exclude_recursion) continue;
      if (pass < Number(x.delay_until_recursion ?? 0)) continue;
      const text = messages.slice(-Number(x.scan_depth ?? scanDepth)).map(m => m.content).join('\n') + (x.exclude_recursion ? '' : '\n' + recursion);
      const matched = entry.key.some(key => keywordMatches(key, text, normalized));
      if (!(entry.constant || forced.has(entry.id) || sticky || matched)) continue;
      if (!entry.constant && !forced.has(entry.id) && !sticky && entry.selective && entry.keysecondary.length) {
        const matches = entry.keysecondary.map(key => keywordMatches(key, text, normalized));
        const conditions = [matches.some(Boolean), !matches.every(Boolean), !matches.some(Boolean), matches.every(Boolean)];
        if (!conditions[x.selectiveLogic ?? 0]) continue;
      }
      if (!sticky && x.useProbability !== false && random() * 100 >= Number(x.probability ?? 100)) continue;
      candidates.push(entry);
    }
    const groups = new Map();
    for (const entry of candidates) {
      if (!entry.group) { selected.set(`${entry.world}.${entry.uid}`, entry); continue; }
      const name = entry.group;
      if ([...selected.values()].some(e => e.group === name)) continue;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(entry);
    }
    for (const values of groups.values()) {
      let winner = values.find(e => e.groupOverride);
      if (!winner) {
        const weights = values.map(e => Math.max(0, Number(e.groupWeight ?? 100)));
        let pick = random() * weights.reduce((a, b) => a + b, 0);
        winner = values.find((e, i) => (pick -= weights[i]) <= 0) ?? values[0];
      }
      selected.set(`${winner.world}.${winner.uid}`, winner);
    }
    const added = candidates.filter(e => selected.has(`${e.world}.${e.uid}`));
    recursion += '\n' + added.filter(e => !e.preventRecursion).map(e => e.content).join('\n');
    const data = { state: { current: scanState, next: added.length && pass < passes ? 2 : 0, loopCount: pass + 1 },
      new: { all: candidates, successful: added }, activated: { entries: selected, text: recursion }, sortedEntries: sorted,
      recursionDelay, budget, timedEffects: states };
    yield { name: 'worldinfo_scan_done', data };
    scanState = data.state.next;
    recursion = data.activated.text;
    recursionDelay.currentLevel = pass + 1;
    if (!scanState) break;
  }
  for (const entry of selected.values()) if (states[entry.id] === undefined || turn - states[entry.id] >= Number(entry.sticky ?? 0)) states[entry.id] = turn;
  return { entries: [...selected.values()].sort((a, b) => a.order - b.order).map(fromWorldInfoEntry), history: states };
}
