import { presetPrompts } from './presets.js';
import { renderTemplates } from './templates.js';
import { describeTables } from './tables.js';
import { normalizeWorldbook, activateWorldbook } from './worldbook.js';
import { allRegex, applyRegex, macroEnvironment } from './macros.js';
import { effectiveMessages } from './memory-state.js';
import { interactionInstruction } from './interaction.js';
import { staticText, staticEntry, stableFirst, trimHistory } from './prompt-context.js';
import { withWritingLength } from './writing-length.js';
export { allRegex } from './macros.js';

export function isTableFillEntry(entry) {
  return /读写规则|填表规则|填表说明|表格更新规则/.test(String(entry?.comment ?? entry?.title ?? ''));
}

export function tableFillEntries(worldbook) {
  return (worldbook ?? []).filter(entry => entry.enabled !== false && entry.content?.trim() && isTableFillEntry(entry));
}

export function environmentFor(state, card) {
  return {
    user: state.userName, char: card.name, persona: state.persona ?? '', description: card.description ?? '', personality: card.personality ?? '', scenario: card.scenario ?? '',
    sessionId: state.id, input: effectiveMessages(state).findLast(m => m.role === 'user')?.content ?? '', messages: effectiveMessages(state),
    variables: structuredClone(state.variables ?? {}), globalVariables: structuredClone(state.globalVariables ?? {}),
    characterVariables: structuredClone(state.characterVariables ?? {}), presetVariables: structuredClone(state.presetVariables ?? {}), messageVariables: structuredClone(state.messageVariables ?? {}), messageSwipes: Object.fromEntries((state.helperChat ?? []).map((message, index) => [index, message.swipe_id ?? 0])),
    now: state.turnStartedAt ?? new Date().toISOString(), card,
  };
}

export async function prepareWorldbook(state, card, extraBooks = [], signal) {
  return prepareEntries(state, card, [
    ...normalizeWorldbook({ ...card.character_book, name: card.character_book?.name ?? card.name }, 'card'),
    ...extraBooks.flatMap(book => normalizeWorldbook({ ...book.data, name: book.name }, book.id)),
  ], signal);
}

export async function prepareAdvanceWorldbooks(state, card, books, signal) {
  const normalized = books.map(book => normalizeWorldbook({ ...book.data, name: book.name }, book.source === 'character' ? 'card' : book.id));
  const entries = await prepareEntries(state, card, normalized.flat(), signal);
  let offset = 0;
  return books.map(({ id, name, source }, index) => ({ id, name, source, entries: entries.slice(offset, offset += normalized[index].length) }));
}

async function prepareEntries(state, card, entries, signal) {
  entries = entries.map(entry => ({ ...entry, cacheStatic: staticText(entry.content), extensions: { ...entry.extensions, case_sensitive: entry.extensions.case_sensitive ?? state.worldbookSettings?.case_sensitive, match_whole_words: entry.extensions.match_whole_words ?? state.worldbookSettings?.match_whole_words } }));
  const result = await renderTemplates({ env: { ...environmentFor(state, card), worldbook: entries }, tables: describeTables(state.tables), texts: entries.map(entry => ({ text: entry.content, macros: false, ejs: false })) }, { signal });
  return entries.map((entry, index) => ({ ...entry, content: result.texts[index] }));
}

function examples(text, user, char) {
  if (!text.trim()) return [];
  const result = [];
  let current;
  for (const line of text.replaceAll('{{user}}', user).replaceAll('{{char}}', char).split('\n')) {
    if (/^\s*<START>\s*$/i.test(line)) { current = undefined; continue; }
    const role = line.startsWith(`${user}:`) ? 'user' : line.startsWith(`${char}:`) ? 'assistant' : null;
    if (role) {
      current = { role, content: line.slice((role === 'user' ? user : char).length + 1).trimStart() };
      result.push(current);
    } else if (current) current.content += '\n' + line;
    else if (line.trim()) { current = { role: 'system', content: line }; result.push(current); }
  }
  return result;
}

function insertDepth(history, injections) {
  const groups = new Map();
  for (const item of injections) {
    const position = Math.max(0, history.length - Math.max(0, Number(item.depth ?? 0)));
    if (!groups.has(position)) groups.set(position, []);
    groups.get(position).push(item);
  }
  const result = [];
  for (let i = 0; i <= history.length; i++) {
    result.push(...(groups.get(i) ?? []).sort((a, b) => (a.order ?? 100) - (b.order ?? 100)).map(item => ({ role: item.role, content: item.content })));
    if (i < history.length) result.push(history[i]);
  }
  return result;
}

export async function assembleWritingPrompt({ state, card, preset, worldbook, plan, summarySelectionEnabled = false, forcedWorldIds = [], regex = [], extraContext = '', trigger = 'normal', signal, scanWorldbook, deferBudget = false, deferLength = false }) {
  const messagesForPrompt = effectiveMessages(state).filter(message => !message.hidden);
  const normal = (state.config.playMode ?? 'agent') === 'normal';
  const previous = messagesForPrompt.findLastIndex(message => message.role === 'assistant' && !message.greeting);
  const rawHistory = normal ? messagesForPrompt : previous < 0 ? messagesForPrompt.filter(message => message.role === 'user') : messagesForPrompt.slice(previous);
  const env = macroEnvironment(environmentFor(state, card));
  env.worldbook = worldbook;
  const tableDescriptions = describeTables(state.tables);
  const scripts = allRegex(card, preset, regex, state.regexOrder);
  const transformed = await renderTemplates({ env, tables: tableDescriptions, regexScripts: scripts, texts: rawHistory.map((message, index) => ({ text: message.content, regexPhase: normal ? 'prompt' : undefined, placement: message.role === 'user' ? 1 : 2, depth: rawHistory.length - index - 1, macros: false, ejs: false, conditions: false })) }, { signal });
  const history = rawHistory.map((message, index) => ({ role: message.role, content: transformed.texts[index], history: index < rawHistory.length - 1 || message.role !== 'user', raw: true }));
  const scanOptions = { messages: messagesForPrompt, turn: state.turn ?? 0, history: state.worldActivation, forcedIds: forcedWorldIds, trigger, settings: state.worldbookSettings };
  const activated = scanWorldbook ? await scanWorldbook({ entries: worldbook, options: scanOptions }, signal) : activateWorldbook(worldbook, scanOptions);
  for (const key of ['variables', 'globalVariables', 'characterVariables', 'presetVariables', 'messageVariables']) if (activated[key]) env[key] = activated[key];
  const world = { before: [], after: [], depth: [], topExamples: [], bottomExamples: [], notesTop: [], notesBottom: [] };
  for (const entry of stableFirst(activated.entries)) {
    if (isTableFillEntry(entry)) continue;
    const placement = Number(entry.extensions.position ?? 0);
    const depth = entry.extensions.depth ?? 4;
    const content = applyRegex(entry.content, scripts, { placement: 5, phase: 'prompt', depth: placement === 4 ? depth : null, env });
    if (!content) continue;
    const role = ['system', 'user', 'assistant'][Number(entry.extensions.role ?? 0)] ?? 'system';
    const item = { role, content, depth, order: entry.insertion_order, cacheStatic: placement <= 1 && staticEntry(entry) && entry.content === worldbook.find(source => source.id === entry.id)?.content };
    if (placement === 0) world.before.push(item);
    else if (placement === 1) world.after.push(item);
    else if (placement === 4) world.depth.push(item);
    else if (placement === 5) world.topExamples.push(item);
    else if (placement === 6) world.bottomExamples.push(item);
    else if (placement === 2) world.notesTop.push(item);
    else if (placement === 3) world.notesBottom.push(item);
    else env.diagnostics = [...(env.diagnostics ?? []), `世界书条目 ${entry.comment ?? entry.id} 的位置 ${placement} 没有绑定输出位置`];
  }
  const prompts = presetPrompts(preset).filter(prompt => prompt.enabled && (!prompt.injection_trigger?.length || prompt.injection_trigger.includes(trigger)));
  const injections = [...world.depth, ...prompts.filter(p => p.position?.type === 'in_chat').map(p => ({ role: p.role ?? 'system', content: p.content ?? '', depth: p.position.depth, order: p.position.order }))];
  injections.push(...(state.injections ?? []).filter(p => p.position === 'in_chat').map(p => ({ role: p.role ?? 'system', content: p.content ?? '', depth: p.depth ?? 0, order: p.order ?? 100 })));
  const depthPrompt = card.extensions?.depth_prompt;
  if (depthPrompt?.prompt) injections.push({ role: depthPrompt.role ?? 'system', content: depthPrompt.prompt, depth: depthPrompt.depth ?? 4, order: 100 });
  injections.push(...world.notesTop.map(p => ({ ...p, depth: 0, order: 0 })), ...world.notesBottom.map(p => ({ ...p, depth: 0, order: 200 })));
  const format = (pattern, value) => pattern ? pattern.replaceAll('{0}', value) : value;
  const markers = {
    worldInfoBefore: world.before, worldInfoAfter: world.after,
    charDescription: [{ role: 'system', content: card.description ?? '', cacheStatic: staticText(card.description) }],
    charPersonality: [{ role: 'system', content: format(preset?.personality_format, card.personality ?? ''), cacheStatic: staticText(card.personality) }],
    scenario: [{ role: 'system', content: format(preset?.scenario_format, card.scenario ?? ''), cacheStatic: staticText(card.scenario) }],
    personaDescription: [{ role: 'system', content: state.persona ?? '', cacheStatic: staticText(state.persona) }],
    dialogueExamples: [...world.topExamples, ...examples(card.mes_example ?? '', state.userName, card.name), ...world.bottomExamples],
    chatHistory: insertDepth(history, injections),
  };
  let messages = [];
  if (preset) {
    for (const prompt of prompts) {
      if (prompt.position?.type === 'in_chat') continue;
      if (markers[prompt.id]) { messages.push(...markers[prompt.id]); continue; }
      let content = prompt.content ?? '';
      if (!prompt.forbid_overrides && prompt.id === 'main' && card.system_prompt) content = card.system_prompt;
      if (!prompt.forbid_overrides && prompt.id === 'jailbreak' && card.post_history_instructions) content = card.post_history_instructions;
      messages.push({ role: prompt.role ?? 'system', content, cacheStatic: staticText(content) });
    }
  } else {
    messages = [{ role: 'system', content: card.system_prompt || '根据角色设定、世界资料和已发生的剧情进行互动创作。', cacheStatic: staticText(card.system_prompt) }, ...markers.worldInfoBefore, ...markers.personaDescription, ...markers.charDescription, ...markers.charPersonality, ...markers.scenario, ...markers.worldInfoAfter, ...markers.dialogueExamples, ...markers.chatHistory];
    if (card.post_history_instructions) messages.push({ role: 'system', content: card.post_history_instructions });
  }
  messages.unshift(...(state.injections ?? []).filter(p => p.position === 'before_prompt').map(p => ({ role: p.role ?? 'system', content: p.content, cacheStatic: staticText(p.content) })));
  messages.push(...(state.injections ?? []).filter(p => p.position === 'after_prompt').map(p => ({ role: p.role ?? 'system', content: p.content, cacheStatic: staticText(p.content) })));
  if (state.renderMode !== 'text' && !(state.injections ?? []).some(p => p.id === 'speech-desk-format' && p.content?.trim())) messages.push({ role: 'system', content: '角色开口写成 [角色|完整全名|情绪]〖台词〗，心里话写成 [角色|完整全名|情绪]{内心}，玩家开口写成 [角色|user|情绪]〖台词〗。角色卡要求的其它正文协议（剧情标签、选项、状态栏、HTML 等）全部保留。', cacheStatic: true });
  if (!state.presetId && state.renderMode !== 'text') messages.push({ role: 'system', content: interactionInstruction, cacheStatic: true });
  if (state.config.agents?.write?.prompt) messages.push({ role: 'system', content: state.config.agents.write.prompt, cacheStatic: staticText(state.config.agents.write.prompt) });
  if (extraContext) messages.push({ role: 'system', content: extraContext });
  if (plan) messages.push({ role: 'system', content: `本轮推进设计：\n${JSON.stringify(plan)}\n据此续写当前剧情。按角色卡与预设输出完整正文，以及它们要求的台词框、选项、HTML 状态栏等前端数据协议，供卡片脚本处理。不要承担填表：不要在正文中输出表格逐行更新；填表由填表 agent 根据已完成正文执行。` });
  if (trigger === 'continue' && preset?.continue_nudge_prompt) messages.push({ role: 'system', content: preset.continue_nudge_prompt });
  if (preset?.assistant_prefill) messages.push({ role: 'assistant', content: preset.assistant_prefill });
  const rendered = await renderTemplates({ env, tables: tableDescriptions, regexScripts: scripts, texts: messages.map(message => ({ text: message.content, ...(message.raw ? { macros: false, ejs: false, conditions: false } : {}) })) }, { signal });
  messages = messages.map((message, index) => ({ ...message, content: rendered.texts[index] })).filter(message => message.content.trim());
  const fixed = message => message.cacheStatic === true;
  messages = [...messages.filter(fixed), ...messages.filter(message => !fixed(message))];
  if (!deferLength) messages = withWritingLength(messages, state.config);
  if (normal && !deferBudget) messages = trimHistory(messages, state.config.normalMaxInputTokens ?? 200000);
  const historyMessages = messages.filter(message => message.history).map(({ role, content }) => ({ role, content }));
  messages = messages.map(({ role, content }) => ({ role, content }));
  if (preset?.squash_system_messages) {
    const merged = [];
    for (const message of messages) {
      if (message.role === 'system' && merged.at(-1)?.role === 'system') merged.at(-1).content += '\n\n' + message.content;
      else merged.push({ ...message });
    }
    messages = merged;
  }
  return { messages, historyMessages, variables: rendered.variables, globalVariables: rendered.globalVariables, diagnostics: rendered.diagnostics, worldActivation: activated.history, worldEntryIds: activated.entries.map(e => e.id), worldEntries: activated.entries };
}
