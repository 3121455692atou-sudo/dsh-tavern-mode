import { sharedMemorySchema, SHARED_MEMORY_INSTRUCTIONS, memoryEpisodes, recallBundle, validateSharedMemory, recordSharedEvents } from './shared-memory.js';
import { renderToolPrompts, explicitToolPreset } from './tool-prompts.js';
import { focusedToolInput, focusedInstructions, toolRepairContext } from './tool-policy.js';
import { randomUUID } from 'node:crypto';
import { worldbookDirectory, orderedToolInput, orderedToolMessages, fixedToolMessages, toolWorldbook, tableTemplateView, evidenceSourceView, advanceResultView } from './tool-context.js';
import { factView, episodeView, recallView, trimHistory, stableFirst } from './prompt-context.js';
import { recordTableChanges } from './table-history.js';
import { INTERACTION, repairInteraction } from './interaction.js';
import { RECALL, SEARCH_QUERY, COMBINATION, PLAN, MEMORY, TABLE_UPDATE, ROLE_INSTRUCTIONS, ROSTER, ProtocolError, validateProtocol } from './contracts.js';
import { prepareWorldbook, prepareAdvanceWorldbooks, assembleWritingPrompt, allRegex, environmentFor, tableFillEntries } from './prompts.js';
import { activateWorldbook, keywordMatches } from './worldbook.js';
import { describeTables, applyTableOperations } from './tables.js';
import { legacyPromptMessages } from './presets.js';
import { hasAdvanceTasks, hasSummarySelection, runAdvancePreset } from './advance.js';
import { summaryIndex } from './summary-index.js';
import { renderTemplates } from './templates.js';
import { effectiveMessages, memoryCandidates, currentFacts, validateStateChanges, recordStateChanges, validateEvidence, evidenceSources, resolveEvidence, resolveStateChanges } from './memory.js';

async function renderedToolPreset(preset, { stage, explicit, mode, state, card, signal, prompt }) {
  return renderToolPrompts(preset, { stage, explicit, mode, prompt }, texts => renderTemplates({ env: environmentFor(state, card), tables: describeTables(state.tables), texts }, { signal, timeout: state.config.templateTimeout }));
}

export async function mapConcurrent(values, limit, run) {
  const result = new Array(values.length);
  let next = 0, failure;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (!failure && next < values.length) {
      const index = next++;
      try { result[index] = await run(values[index], index); }
      catch (error) { failure ??= error; }
    }
  }));
  // Let already-running siblings finish and checkpoint their results. A stage
  // error stops unscheduled work; it must not discard other paid completions.
  if (failure) throw failure;
  return result;
}

function assertIds(ids, allowed, label) {
  const set = new Set(allowed);
  for (const id of ids) if (!set.has(id)) throw new ProtocolError(`${label} 引用了不存在的 id：${id}`);
  if (new Set(ids).size !== ids.length) throw new ProtocolError(`${label} 含重复 id`);
}

export async function buildRoster({ state, card, extraBooks, callModel, text = '', emit = () => {}, signal, toolPreset = null, agentPresets = {}, runIdentity }) {
  const worldbook = await prepareWorldbook(state, card, extraBooks, signal);
  const relevant = activateWorldbook(worldbook, { messages: [...effectiveMessages(state).filter(message => !message.hidden), ...(text ? [{ role: 'user', content: text }] : [])], turn: state.turn ?? 0, history: state.worldActivation, settings: state.worldbookSettings }).entries;
  const checkRoster = result => {
    const names = new Set();
    for (const character of result.characters) {
      if (!character.name.trim() || names.has(character.name)) throw new ProtocolError('角色目录含空名称或重复名称');
      names.add(character.name);
      assertIds(character.worldbookIds, relevant.map(entry => entry.id), '角色世界书');
    }
  };
  emit({ type: 'stage', stage: 'roster', status: 'running' });
  const rosterPreset = state.config.agents.combine?.presetId ? agentPresets[state.config.agents.combine.presetId] ?? toolPreset : toolPreset;
  const rosterMessages = await renderedToolPreset(rosterPreset, { stage: 'roster', explicit: explicitToolPreset(state.config.agents.combine, agentPresets), mode: state.config.toolContextMode ?? 'focused', state, card, signal });
  const result = await callModel({ sessionId: state.id, stage: 'roster', label: '识别角色', agent: state.config.agents.combine, schema: ROSTER, retries: state.config.protocolRetries, signal, validate: checkRoster, messages: orderedToolMessages([
    ...rosterMessages, { role: 'system', content: ROLE_INSTRUCTIONS.roster, cacheStatic: true },
    { role: 'user', content: JSON.stringify(orderedToolInput({ card: { name: card.name, description: card.description, personality: card.personality, scenario: card.scenario, firstMessage: card.first_mes }, ...toolWorldbook(relevant), userInput: text })) },
  ]) });
  checkRoster(result);
  const names = new Set();
  const characters = result.characters.map(character => {
    names.add(character.name);
    const previous = state.characters.find(c => c.name === character.name);
    return { ...previous, ...character, id: previous?.id ?? runIdentity?.id(`roster:${character.name}`) ?? randomUUID(), enabled: previous?.enabled ?? true };
  });
  // Existing actors keep their identity and memory even when the model omits them.
  return [...characters, ...state.characters.filter(c => !names.has(c.name))];
}

export async function runTurn({ state: inputState, card, preset, toolPreset = null, agentPresets = {}, legacy, extraBooks = [], advanceWorldbooks, regex = [], callModel, text, trigger = 'normal', signal, emit = () => {}, scanWorldbook, beforeWrite, afterWrite, beforeCommit, onStory, runIdentity }) {
  const state = structuredClone(inputState);
  const controller = new AbortController();
  const runSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const trace = [];
  const config = state.config;
  const turnId = runIdentity?.id('turn') ?? randomUUID();
  state.turnStartedAt = runIdentity?.startedAt ?? new Date().toISOString();
  const userMessage = { id: runIdentity?.id('user') ?? randomUUID(), role: 'user', name: state.userName, content: text, createdAt: state.turnStartedAt, turnId };
  if (trigger !== 'continue') state.messages.push(userMessage);
  const presetFor = stage => {
    const id = config.agents[stage]?.presetId;
    if (!id) return stage === 'write' ? preset : toolPreset;
    if (stage === 'write' && id === inputState.presetId) return preset;
    return agentPresets[id] ?? (stage === 'write' ? preset : toolPreset);
  };
  const stageCall = createStageCaller({ state, card, toolPreset, agentPresets, callModel, signal: runSignal, emit, trace });
  try {
    const scripts = allRegex(card, preset, regex, state.regexOrder);
    if (trigger !== 'continue') {
      const rendered = await renderTemplates({ env: environmentFor(state, card), tables: describeTables(state.tables), regexScripts: scripts, texts: [{ text, regexPhase: 'source', placement: 1, depth: 0, macros: false, ejs: false, conditions: false }] }, { signal: runSignal, timeout: config.templateTimeout });
      userMessage.content = rendered.texts[0];
    }
    const worldbook = await prepareWorldbook(state, card, extraBooks, runSignal);
    const effectiveHistory = effectiveMessages(state).filter(message => !message.hidden);
    const normal = (config.playMode ?? 'agent') === 'normal';
    const importedFlow = !normal && config.toolContextMode !== 'full' && hasAdvanceTasks(legacy);
    const reuse = state.rewrite;
    delete state.rewrite;
    let combined, advance, plan, recalls = [], actors = [], allWorldState = [], worldState = [], worldEpisodes = [], summarySelectionEnabled = false, replacements;
    if (!normal) {
    const recent = effectiveHistory.slice(-config.historyTurns * 2);
    const publicScene = { scene: state.scene, messages: recent.map(m => ({ role: m.role, name: m.name, content: m.content })), userInput: text, trigger };
    actors = state.characters.filter(c => c.enabled !== false);
    if (reuse && !(reuse.combination && reuse.plan && reuse.recalls)) throw new Error('没有可复用的推进结果，请全部重新生成');
    recalls = reuse ? reuse.recalls : await mapConcurrent(actors, config.concurrency, async character => {
      const memories = memoryEpisodes(state, character.id);
      if (!memories.length) return { characterId: character.id, characterName: character.name, memories: [], currentState: [], queries: [], records: [] };
      const profileEntries = worldbook.filter(entry => entry.enabled && (character.worldbookIds?.includes(entry.id) || entry.keys.some(key => keywordMatches(key, character.name, entry))));
      const allCurrentState = currentFacts(memories);
      const context = { character: { id: character.id, name: character.name, profile: character.profile }, ...toolWorldbook(profileEntries), currentState: memoryCandidates(allCurrentState, [text], config.recallBatchSize).map(fact => factView(fact, true)), currentStateCount: allCurrentState.length, sceneHint: { location: state.scene.location, time: state.scene.time }, userInput: text, trigger };
      const queries = memories.length > config.recallBatchSize || allCurrentState.length > config.recallBatchSize ? (await stageCall('recall', { ...context, recentMemories: memories.slice(-config.recallCount).map(memory => episodeView(memory)), task: '为该角色本轮需要回忆的经历生成简短全文检索查询。根据输入中的指代、当前角色知识和近期经历补全相关人物、物品、地点、事件及同义表达；这只是查询，不是新的记忆。' }, SEARCH_QUERY, `${character.name}·检索`, [], character.recallModel)).queries : [text];
      const currentState = memoryCandidates(allCurrentState, queries, config.recallBatchSize);
      context.currentState = currentState;
      const candidates = memoryCandidates(memories, queries, config.recallBatchSize);
      const check = output => {
        if (output.characterId !== character.id) throw new ProtocolError('召回结果的角色归属错误');
        assertIds(output.memories.map(m => m.id), candidates.map(m => m.id), '记忆召回');
      };
      const recallSchema = RECALL;
      const output = await stageCall('recall', { character: context.character, memories: candidates.map(memory => episodeView(memory, true)), ...context, currentState: currentState.map(fact => factView(fact, true)), maximumRecallCount: config.recallCount }, recallSchema, character.name, [], character.recallModel, check);
      const selected = output.memories.sort((a, b) => b.relevance - a.relevance).slice(0, config.recallCount);
      return { ...output, memories: selected, characterName: character.name, currentState, queries, records: selected.map(m => candidates.find(record => record.id === m.id)) };
    });
    allWorldState = currentFacts(state.worldHistory);
    worldState = memoryCandidates(allWorldState, [text, state.scene.location, ...recalls.flatMap(recall => recall.queries)], config.recallBatchSize);
    worldEpisodes = memoryCandidates(state.worldHistory ?? [], [text, ...recalls.flatMap(recall => recall.queries)], config.recallCount);
    const activated = activateWorldbook(worldbook, { messages: effectiveHistory, turn: state.turn ?? 0, history: state.worldActivation, trigger, settings: state.worldbookSettings });
    const checkCombination = combined => {
      assertIds(combined.presentCharacterIds, actors.map(c => c.id), '场景角色');
      assertIds(combined.characterViews.map(c => c.characterId), actors.map(c => c.id), '角色视角');
      assertIds(combined.worldEntryIds, worldbook.filter(e => e.enabled && e.content.trim()).map(e => e.id), '世界书召回');
    };
    summarySelectionEnabled = hasSummarySelection(legacy);
    const sceneTables = describeTables(state.tables);
    const currentTables = (summarySelectionEnabled ? summaryIndex(sceneTables).currentTables : sceneTables).map(({ name, headers, rows }) => ({ name, headers, rows }));
    replacements = { '$U': state.persona ?? state.userName, '$C': JSON.stringify({ name: card.name, description: card.description, personality: card.personality, scenario: card.scenario }), user: state.userName, char: card.name };
    if (importedFlow) {
      // The imported database preset already IS the planner. Its source does
      // not run an extra scene model or require a second synthetic PLAN.
      combined = { scene: state.scene, presentCharacterIds: [], worldEntryIds: [], situation: '', characterViews: [], openThreads: [] };
      advance = reuse ? reuse.advance : await runAdvancePreset({ state, card, data: legacy, worldbook,
        advanceWorldbooks: advanceWorldbooks ? await prepareAdvanceWorldbooks(state, card, advanceWorldbooks, runSignal) : undefined,
        text, callModel, signal: runSignal, emit, trace, mapConcurrent,
        memoryContext: recallBundle(recalls.filter(recall => recall.records?.length || recall.currentState?.length)),
      });
    } else if (reuse) {
      combined = reuse.combination; advance = reuse.advance; plan = reuse.plan; checkCombination(combined);
    } else {
      combined = await stageCall('combine', {
        characters: actors.map(c => ({ id: c.id, name: c.name, profile: c.profile })),
        worldbookDirectory: worldbookDirectory(worldbook.filter(e => e.enabled && e.content.trim())),
        ...toolWorldbook(activated.entries, 'activeWorldbook'),
        ...publicScene, recalls: recallBundle(recalls), worldState: worldState.map(fact => factView(fact)), worldEpisodes: worldEpisodes.map(episode => episodeView(episode)),
        tables: currentTables,
      }, COMBINATION, '场景组合', [], undefined, checkCombination);
      const advanceDirectory = advanceWorldbooks ? await prepareAdvanceWorldbooks(state, card, advanceWorldbooks, runSignal) : undefined;
      const planWorldbook = stableFirst(worldbook.filter(e => e.enabled && combined.worldEntryIds.includes(e.id)));
      const planInput = { ...publicScene, combination: combined, recalls: recallBundle(recalls), worldState: worldState.map(fact => factView(fact)), worldEpisodes: worldEpisodes.map(episode => episodeView(episode)), tables: currentTables };
      const checkPlan = value => assertIds(value.characterIntents.map(c => c.characterId), combined.presentCharacterIds, '推进计划角色');
      advance = await runAdvancePreset({ state, card, data: legacy, worldbook, advanceWorldbooks: advanceDirectory, text, callModel, signal: runSignal, emit, trace, mapConcurrent,
        planRequest: { schema: PLAN, input: planInput, worldbook: planWorldbook, messages: await renderedToolPreset(presetFor('advance'), { stage: 'advance', explicit: explicitToolPreset(config.agents.advance, agentPresets), mode: config.toolContextMode ?? 'focused', state, card, signal: runSignal, prompt: config.agents.advance.prompt }), instruction: ROLE_INSTRUCTIONS.advance, validate: checkPlan },
      });
      // Selection itself is turn-dependent, even when an entry's text is fixed.
      plan = advance?.plan ?? await stageCall('advance', { worldbook: planWorldbook.map(e => ({ id: e.id, content: e.content })), ...planInput, summaryRecords: advance?.summaryRecords ?? [], ...(advance ? { advanceTasks: advance.results.map(advanceResultView) } : {}) }, PLAN, '剧情推进', advance ? [] : legacyPromptMessages(legacy, 'advance', replacements), undefined, checkPlan);
    }
    emit({ type: 'plan', combination: combined, plan });
    }
    const writingPreset = presetFor('write');
    const recallContext = `召回资料（保留角色归属及经历时间）：\n${JSON.stringify(recallBundle(recalls))}\n当前状态优先于较早的经历；角色知识以各自 currentState 和经历为依据。`;
    const writing = await assembleWritingPrompt({ state, card, preset: writingPreset, worldbook, plan, summarySelectionEnabled, regex, extraContext: normal ? '' : importedFlow ? recallContext : `本轮场景与角色视角：\n${JSON.stringify(combined)}\n${recallContext}\n最后确认的世界状态：\n${JSON.stringify(worldState.map(fact => factView(fact)))}\n相关世界经历：\n${JSON.stringify(worldEpisodes.map(episode => episodeView(episode)))}`, trigger, signal: runSignal, scanWorldbook, deferBudget: true });
    if (advance) writing.messages.push({ role: 'system', content: JSON.stringify({ summaryRecords: advance.summaryRecords }) });
    if (advance?.injection) writing.messages.push({ role: 'system', content: advance.injection });
    const writer = {
      ...config.agents.write,
      temperature: config.agents.write.temperature ?? writingPreset?.temperature ?? 0.9,
      maxTokens: config.agents.write.maxTokens,
      presetReasoningEffort: writingPreset?.reasoning_effort && writingPreset.reasoning_effort !== 'auto' ? writingPreset.reasoning_effort : '',
    };
    if (beforeWrite) {
      const updated = await beforeWrite({ messages: writing.messages, variables: writing.variables, globalVariables: writing.globalVariables, entries: writing.worldEntries }, runSignal);
      if (!Array.isArray(updated.messages) || updated.messages.some(m => !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string')) throw new ProtocolError('前端提示词事件返回了无效消息');
      writing.messages = updated.messages.map(m => ({ role: m.role, content: m.content }));
      if (updated.variables) writing.variables = updated.variables;
      if (updated.globalVariables) writing.globalVariables = updated.globalVariables;
      for (const key of ['characterVariables', 'messageVariables', 'scriptVariables', 'presetVariables', 'extensionSettings', 'worldbookOverrides', 'worldbookSettings', 'presetOverride', 'regexOrder']) if (updated[key]) state[key] = updated[key];
      // Helper presentation edits are kept as metadata; the canonical authored text stays reviewable.
      if (Array.isArray(updated.chat)) state.helperChat = updated.chat.map((message, index) => ({ ...message, tavernMessageId: state.messages[index]?.id }));
    }
    if (normal) {
      const history = new Map();
      for (const message of writing.historyMessages) { const key = JSON.stringify(message); history.set(key, (history.get(key) ?? 0) + 1); }
      writing.messages = trimHistory(writing.messages.map(message => {
        const key = JSON.stringify(message), count = history.get(key) ?? 0;
        if (count) history.set(key, count - 1);
        return { ...message, history: count > 0 };
      }), config.normalMaxInputTokens ?? 200000).map(({ role, content }) => ({ role, content }));
    }
    emit({ type: 'stage', stage: 'write', label: '写作', status: 'running', provider: writer.provider, model: writer.model });
    const usage = [], requests = [], startedAt = Date.now();
    let reasoning = '';
    let story = await callModel({ sessionId: state.id, stage: 'write', label: '写作', agent: writer, messages: writing.messages, signal: runSignal, onText: chunk => emit({ type: 'text', text: chunk }), onReasoning: value => { reasoning = value; }, onUsage: value => usage.push(value), onRequest: value => requests.push(value), retries: 0 });
    if (!/\[角色\|/.test(story) && /(?:^|\n)[^\[\n]{1,40}\|[^|\n]{1,16}\|\[/m.test(story)) {
      const formatUsage = [], formatRequests = [], formatStartedAt = Date.now();
      const washed = await callModel({
        sessionId: state.id, onUsage: value => formatUsage.push(value), onRequest: value => formatRequests.push(value),
        stage: 'format', label: '对白格式', agent: writer, retries: 0, signal: runSignal,
        messages: [
          { role: 'system', content: '下面是已写好的正文。只修正角色开口和心里话的标记，其它全部原样保留（剧情标签、选项、状态栏、HTML、旁白、动作都不改）。开口写成 [角色|完整全名|情绪]〖台词〗，心里话写成 [角色|完整全名|情绪]{内心}。如果没有角色对白标记，就原文返回。不要解释，不要加前后缀。' },
          { role: 'user', content: story },
        ],
      });
      trace.push({ stage: 'format', label: '对白格式', provider: writer.provider, model: writer.model, elapsedMs: Date.now() - formatStartedAt, usage: formatUsage, requests: formatRequests });
      if (typeof washed === 'string' && washed.trim()) story = washed;
    }
    trace.push({ stage: 'write', label: '写作', provider: writer.provider, model: writer.model, elapsedMs: Date.now() - startedAt, usage, requests, worldEntryIds: writing.worldEntryIds, request: writing.messages });
    emit({ type: 'stage', stage: 'write', label: '写作', status: 'done' });
    const post = await renderTemplates({ env: { ...environmentFor(state, card), variables: writing.variables, globalVariables: writing.globalVariables }, tables: describeTables(state.tables), regexScripts: scripts, texts: [{ text: story, regexPhase: 'source', placement: 2, depth: 0, macros: false, ejs: false, conditions: false }] }, { signal: runSignal, timeout: config.templateTimeout });
    const assistant = { id: runIdentity?.id('assistant') ?? randomUUID(), role: 'assistant', name: card.name, content: post.texts[0], ...(reasoning ? { extra: { reasoning } } : {}), createdAt: runIdentity?.startedAt ?? new Date().toISOString(), turnId };
    assistant.content = await repairInteraction(assistant.content, async (content, error) => {
      const usage = [], requests = [], startedAt = Date.now(), label = '修正交互数据';
      const result = await callModel({ sessionId: state.id, stage: 'format', label, agent: writer, schema: INTERACTION, retries: config.protocolRetries, signal: runSignal,
        messages: [{ role: 'system', content: '修正交互数据的 JSON 语法或字段结构，保留状态和行动的原有内容。按给定协议返回 status 与 choices。' }, { role: 'user', content: JSON.stringify({ error, content }) }],
        onUsage: value => usage.push(value), onRequest: value => requests.push(value),
      });
      trace.push({ stage: 'format', label, provider: writer.provider, model: writer.model, elapsedMs: Date.now() - startedAt, usage, requests, result });
      return result;
    });
    if (afterWrite) {
      const processed = await afterWrite({ message: assistant, messages: [...state.messages, assistant], variables: writing.variables, globalVariables: writing.globalVariables, ...Object.fromEntries(['characterVariables', 'messageVariables', 'scriptVariables', 'presetVariables', 'extensionSettings', 'helperChat', 'worldbookOverrides', 'worldbookSettings', 'presetOverride', 'regexOrder'].map(key => [key, state[key]])) }, runSignal);
      if (typeof processed.message !== 'string') throw new ProtocolError('前端正文处理返回了无效消息');
      assistant.content = processed.message;
      if (processed.variables) writing.variables = processed.variables;
      if (processed.globalVariables) writing.globalVariables = processed.globalVariables;
      for (const key of ['characterVariables', 'messageVariables', 'scriptVariables', 'presetVariables', 'extensionSettings', 'worldbookOverrides', 'worldbookSettings', 'presetOverride', 'regexOrder']) if (processed[key]) state[key] = processed[key];
      if (processed.chat) state.helperChat = processed.chat.map((message, index) => ({ ...message, tavernMessageId: [...state.messages, assistant][index]?.id }));
    }
    state.messages.push(assistant);
    if (beforeCommit) {
      const latest = await beforeCommit(runSignal);
      if (latest.variables) writing.variables = latest.variables;
      if (latest.globalVariables) writing.globalVariables = latest.globalVariables;
      for (const key of ['characterVariables', 'messageVariables', 'scriptVariables', 'presetVariables', 'extensionSettings', 'worldbookOverrides', 'worldbookSettings', 'presetOverride', 'regexOrder']) if (latest[key]) state[key] = latest[key];
      if (latest.chat) state.helperChat = latest.chat.map((message, index) => ({ ...message, tavernMessageId: state.messages[index]?.id }));
    }
    state.turn = (state.turn ?? 0) + 1;
    state.variables = writing.variables;
    state.globalVariables = writing.globalVariables;
    state.worldActivation = writing.worldActivation;
    state.lastRun = { id: turnId, startedAt: state.turnStartedAt, finishedAt: new Date().toISOString(), trigger, combination: combined ?? { scene: state.scene, presentCharacterIds: [], worldEntryIds: writing.worldEntryIds, situation: '', characterViews: [], openThreads: [] }, plan: plan ?? { scene: state.scene, beats: [], characterIntents: [], constraints: [] }, recalls, advance: advance && { summaryRecords: advance.summaryRecords, injection: advance.injection }, trace, diagnostics: writing.diagnostics, previousRevision: inputState.revision };
    if (!normal) state.pendingUpdates = {
      context: { actors, combined, recalls, worldState, allWorldState,
        sourceMessages: trigger === 'continue' ? [assistant] : [userMessage, assistant], assistant, text, turnId,
        tableExtras: [...legacyPromptMessages(legacy, 'table', replacements), ...tableFillEntries(worldbook).map(entry => ({ role: 'system', content: entry.content, cacheStatic: entry.cacheStatic }))] },
      results: {}, startedAt: state.turnStartedAt,
    };
    // A rendered, authored message is history even if a subsequent tool fails.
    // Persist it before offering any table/memory task to the native dispatcher.
    await onStory?.(structuredClone(state));
    if (!normal) await resumeStoryUpdates({ state, card, toolPreset, agentPresets, callModel, signal: runSignal, emit, runIdentity, onProgress: value => onStory?.(structuredClone(value)) });
    if (runSignal.aborted) throw runSignal.reason ?? new Error('生成已取消');
    return state;
  } catch (error) { controller.abort(error); throw error; }
}

function createStageCaller({ state, card, toolPreset, agentPresets, callModel, signal: runSignal, emit = () => {}, trace = [] }) {
  const config = state.config;
  const stageCall = async (stage, input, schema, label = stage, extras = [], override, validate) => {
    const agent = { ...config.agents[stage], ...(override ?? {}) };
    emit({ type: 'stage', stage, label, status: 'running', provider: agent.provider, model: agent.model });
    const startedAt = Date.now();
    const usage = [], requests = [];
    const mode = config.toolContextMode ?? 'focused';
    input = focusedToolInput(stage, input, { mode, turn: state.turn ?? 0 });
    const selectedPreset = config.agents[stage]?.presetId ? agentPresets[config.agents[stage].presetId] ?? toolPreset : toolPreset;
    const presetMessages = await renderedToolPreset(selectedPreset, { stage, explicit: explicitToolPreset(config.agents[stage], agentPresets), mode, state, card, signal: runSignal, prompt: agent.prompt });
    const instructions = [...presetMessages, { role: 'system', content: [ROLE_INSTRUCTIONS[stage], mode !== 'full' ? focusedInstructions[stage] : ''].filter(Boolean).join('\n\n'), cacheStatic: true }, ...fixedToolMessages(extras)];
    const messages = orderedToolMessages([...instructions.filter(message => message.cacheStatic), { role: 'user', content: JSON.stringify(orderedToolInput(input)) }, ...instructions.filter(message => !message.cacheStatic)]);
    const result = await callModel({ sessionId: state.id, stage, label, agent, messages, schema, signal: runSignal, retries: config.protocolRetries, onUsage: value => usage.push(value), onRequest: value => requests.push(value), repairContext: toolRepairContext(stage, input), validate });
    validateProtocol(result, schema);
    validate?.(result);
    const record = { stage, label, provider: agent.provider, model: agent.model, elapsedMs: Date.now() - startedAt, usage, requests, contextMode: mode, result };
    trace.push(record);
    emit({ type: 'stage', stage, label, status: 'done', elapsedMs: record.elapsedMs });
    return result;
  };
  return stageCall;
}

async function applyStoryUpdates({ state, context, stageCall, runIdentity, completedResults = {} }) {
  const config = state.config;
  const { actors, combined, recalls, worldState, allWorldState, sourceMessages, assistant, text, turnId, tableExtras } = context;
    const memoryActors = actors.filter(c => combined.presentCharacterIds.includes(c.id));
    const tableDescriptions = describeTables(state.tables);
    const sourcePassages = evidenceSources(sourceMessages);
    const modelSources = evidenceSourceView(sourcePassages);
    const resolveRecords = records => records.map(record => ({ ...record, evidence: resolveEvidence(record.evidence, sourcePassages) }));
    const updateMemory = async character => {
      const recall = recalls.find(recall => recall.characterId === character.id) ?? { records: [], currentState: [] };
      const currentState = currentFacts(state.memories[character.id]);
      const previousMemories = [...new Map([...recall.records, ...memoryEpisodes(state, character.id).slice(-config.recallCount)].map(memory => [memory.id, memory])).values()];
      const check = memory => {
        if (memory.characterId !== character.id) throw new ProtocolError('新记忆的角色归属错误');
        validateStateChanges(resolveStateChanges(memory.stateChanges, currentState, sourcePassages), currentState, sourceMessages);
      };
      const memory = await stageCall('memory', { character: { id: character.id, name: character.name, profile: character.profile }, previousMemories: previousMemories.map(memory => episodeView(memory)), currentState: currentState.map(fact => factView(fact, true)), previousScene: state.scene, userInput: text, completedStoryMessageId: assistant.id, sourcePassages: modelSources }, MEMORY, character.name, [], character.memoryModel, check);
      return { type: 'memory', memory: { ...memory, stateChanges: resolveStateChanges(memory.stateChanges, currentState, sourcePassages) } };
    };
    const memoryJobs = characters => {
      if (config.toolContextMode === 'full') return characters.map(character => ({ type: 'memory', characters: [character] }));
      const groups = new Map();
      for (const character of characters) {
        // A previously successful individual update is already paid for.
        const cached = Object.hasOwn(completedResults, JSON.stringify(['memory', character.name]));
        const key = cached ? character.id : JSON.stringify(character.memoryModel ?? {});
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(character);
      }
      return [...groups.values()].map(characters => ({ type: 'memory', characters }));
    };
    const updateMemories = async characters => {
      if (characters.length === 1) return [await updateMemory(characters[0])];
      const currents = new Map(characters.map(character => [character.id, currentFacts(state.memories[character.id])]));
      const check = result => validateSharedMemory(result, characters,
        character => validateStateChanges(resolveStateChanges(character.stateChanges, currents.get(character.characterId), sourcePassages), currents.get(character.characterId), sourceMessages),
        evidence => validateEvidence(resolveEvidence(evidence, sourcePassages), sourceMessages));
      const previous = characters.map(character => ({ characterId: character.id, characterName: character.name,
        records: memoryEpisodes(state, character.id).slice(-config.recallCount), currentState: [] }));
      const result = await stageCall('memory', {
        task: SHARED_MEMORY_INSTRUCTIONS,
        characters: characters.map(({ id, name, profile }) => ({ id, name, profile })),
        characterStates: characters.map(character => ({ characterId: character.id, currentState: currents.get(character.id).map(fact => factView(fact, true)) })),
        previousEvents: recallBundle(previous),
        previousScene: state.scene, completedStoryMessageId: assistant.id, sourcePassages: modelSources,
      }, sharedMemorySchema(MEMORY), '共同记忆 · ' + characters.map(character => character.name).join('、'), [], characters[0].memoryModel, check);
      const memories = recordSharedEvents(result, { state, turnId, createdAt: assistant.createdAt,
        sourceMessageIds: sourceMessages.map(message => message.id), resolveEvidence: evidence => resolveEvidence(evidence, sourcePassages) });
      return memories.map(memory => ({ type: 'memory', memory: { ...memory,
        stateChanges: resolveStateChanges(memory.stateChanges, currents.get(memory.characterId), sourcePassages) } }));
    };
    const checkTables = tables => {
      validateStateChanges(resolveStateChanges(tables.worldChanges, allWorldState, sourcePassages), allWorldState, sourceMessages);
      assertIds(tables.participatingCharacters.map(character => character.characterId), actors.map(character => character.id), '正文参与角色');
      for (const character of tables.participatingCharacters) validateEvidence(resolveEvidence(character.evidence, sourcePassages), [assistant]);
      const names = new Set(state.characters.map(character => character.name));
      for (const character of tables.newCharacters) {
        if (!character.name.trim() || names.has(character.name)) throw new ProtocolError('新角色名称为空或与现有角色重复');
        names.add(character.name); validateEvidence(resolveEvidence(character.evidence, sourcePassages), [assistant]);
      }
      try { applyTableOperations(state.tables, tables.operations); }
      catch (error) { throw new ProtocolError(`表格更新不符合模板约束：${error.message}`); }
    };
    const updates = await mapConcurrent([
      ...memoryJobs(memoryActors),
      { type: 'table' },
    ], config.concurrency, async job => {
      if (job.type === 'memory') return updateMemories(job.characters);
      const tables = await stageCall('table', {
        templates: tableDescriptions.map(tableTemplateView),
        characters: state.characters.map(({ id, name, profile, enabled }) => ({ id, name, profile, enabled: enabled !== false })),
        tableRows: tableDescriptions.map(({ id, rows }) => ({ tableId: id, rows })),
        previousScene: state.scene, userInput: text, completedStoryMessageId: assistant.id,
        currentWorldState: worldState.map(fact => factView(fact, true)), currentWorldStateCount: allWorldState.length, sourcePassages: modelSources,
      }, TABLE_UPDATE, '表格更新', tableExtras, undefined, checkTables);
      return { type: 'table', tables: { ...tables, worldChanges: resolveStateChanges(tables.worldChanges, allWorldState, sourcePassages), newCharacters: resolveRecords(tables.newCharacters) } };
    });
    const tableUpdate = updates.find(update => update.type === 'table').tables;
    context.newCharacterIds ??= {};
    const newCharacters = tableUpdate.newCharacters.map(character => ({ ...character, id: context.newCharacterIds[character.name] ??= runIdentity?.id(`new:${character.name}`) ?? randomUUID(), enabled: true, worldbookIds: [] }));
    const scheduledCharacterIds = new Set(memoryActors.map(character => character.id));
    const additionalActors = tableUpdate.participatingCharacters.filter(character => !scheduledCharacterIds.has(character.characterId)).map(character => actors.find(actor => actor.id === character.characterId));
    state.characters.push(...newCharacters);
    updates.push(...await mapConcurrent(memoryJobs([...additionalActors, ...newCharacters]), config.concurrency, job => updateMemories(job.characters)));
    let nextTables = state.tables;
    for (const update of updates.flat()) {
      if (update.type === 'table') {
        nextTables = applyTableOperations(state.tables, update.tables.operations);
        recordTableChanges(state, nextTables, { turnId, sourceMessageIds: sourceMessages.map(message => message.id), scene: update.tables.scene });
        state.scene = update.tables.scene;
        (state.worldHistory ??= []).push({ id: randomUUID(), turnId, createdAt: assistant.createdAt, sourceMessageIds: sourceMessages.map(message => message.id), summary: state.scene.summary, scene: state.scene, stateChanges: recordStateChanges(update.tables.worldChanges, turnId, assistant.createdAt) });
      }
      else {
        const memory = update.memory;
        if (memory.summary || memory.facts.length || memory.relationships.length || memory.openThreads.length || memory.stateChanges.length || memory.eventIds?.length) {
          (state.memories[memory.characterId] ??= []).push({ ...memory, id: randomUUID(), turnId, sourceMessageIds: sourceMessages.map(message => message.id), createdAt: assistant.createdAt, stateChanges: recordStateChanges(memory.stateChanges, turnId, assistant.createdAt) });
        }
      }
    }
    state.tables = nextTables;

}

export async function resumeStoryUpdates({ state, card, toolPreset = null, agentPresets = {}, callModel, signal, emit = () => {}, runIdentity, onProgress }) {
  const pending = state.pendingUpdates;
  if (!pending) return state;
  const draft = structuredClone(state);
  delete draft.pendingUpdates;
  const trace = state.lastRun?.trace ?? [];
  const call = createStageCaller({ state: draft, card, toolPreset, agentPresets, callModel, signal, emit, trace });
  const stageCall = async (stage, input, schema, label = stage, extras = [], override, validate) => {
    const key = JSON.stringify([stage, label]);
    if (Object.hasOwn(pending.results, key)) {
      const value = structuredClone(pending.results[key]);
      validateProtocol(value, schema); await validate?.(value); return value;
    }
    try {
      const result = await call(stage, input, schema, label, extras, override, validate);
      pending.results[key] = structuredClone(result);
      if (pending.failures) delete pending.failures[key];
      await onProgress?.(state);
      return result;
    } catch (error) {
      (pending.failures ??= {})[key] = { stage, label, message: error.message };
      throw error;
    }
  };
  try {
    await applyStoryUpdates({ state: draft, context: pending.context, stageCall, runIdentity, completedResults: pending.results });
    for (const key of ['tables', 'tableHistory', 'scene', 'characters', 'worldHistory', 'memories', 'memoryEvents']) if (draft[key] !== undefined) state[key] = draft[key];
    delete state.pendingUpdates;
  } catch (error) {
    pending.error = error.message;
    emit({ type: 'stage', stage: 'postprocess', status: 'failed', message: `正文已保存；表格或记忆更新未完成：${error.message}` });
    // Keep the source, successful results and story on disk. The next dispatch
    // resumes only this transaction, before processing any new user input.
  }
  if (state.lastRun) state.lastRun.finishedAt = new Date().toISOString();
  await onProgress?.(state);
  return state;
}
