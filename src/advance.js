import { referenceExistingContext } from './evaluated-context.js';
import { staticEntry, stableFirst } from './prompt-context.js';
import { ProtocolError, validateProtocol } from './contracts.js';
import { describeTables } from './tables.js';
import { environmentFor } from './prompts.js';
import { advanceMessages } from './advance-context.js';
import { activateWorldbook } from './worldbook.js';
import { effectiveMessages } from './memory-state.js';
import { summaryIndex } from './summary-index.js';
import { selectAdvanceWorldbooks } from './session-assets.js';
import { worldbookDirectory, orderedToolMessages, advanceResultView } from './tool-context.js';

const names = value => [...new Set(String(value ?? '').split(',').map(name => name.trim()).filter(Boolean))];
const block = (name, values) => `<${name}>${(values ?? []).join('\n\n')}</${name}>`;
const lookup = (tags, name) => Object.entries(tags).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
const boundaryRules = (rules, tags) => Array.isArray(rules) && rules.length ? rules : names(tags).map(name => ({ start: `<${name}>`, end: `</${name}>` }));

// These delimiters are supplied by the preset; their contents are never classified.
export function filterAdvanceContext(text, profile, extract = false) {
  text = String(text ?? '');
  if (extract) {
    const parts = boundaryRules(profile.contextExtractRules, profile.contextExtractTags).flatMap(({ start, end }) => {
      if (!start || !end) return [];
      const source = text.toLowerCase(), last = source.lastIndexOf(end.toLowerCase()), first = source.lastIndexOf(start.toLowerCase(), last);
      return last >= 0 && first >= 0 ? [text.slice(first, last + end.length)] : [];
    });
    if (parts.length) text = parts.join('\n\n');
  }
  for (const { start, end } of boundaryRules(profile.contextExcludeRules, profile.contextExcludeTags)) {
    if (!start || !end) continue;
    let offset = 0;
    while (offset < text.length) {
      const source = text.toLowerCase(), first = source.indexOf(start.toLowerCase(), offset);
      if (first < 0) break;
      const last = source.indexOf(end.toLowerCase(), first + start.length);
      if (last < 0) break;
      text = text.slice(0, first) + text.slice(last + end.length); offset = first;
    }
  }
  return text.trim();
}

function aggregate(results) {
  const tags = {};
  for (const result of results) for (const [name, content] of Object.entries(result.sections ?? {})) (tags[name] ??= []).push(content);
  return tags;
}

export function hasSummarySelection(data) {
  const profile = data?.plotSettings ?? data;
  return Array.isArray(profile?.plotTasks) && profile.plotTasks.some(task => task.enabled !== false
    && [...names(task.extractTags), ...names(task.extractInjectTags)].some(name => name.toLowerCase() === 'recall'));
}

export function hasAdvanceTasks(data) {
  const profile = data?.plotSettings ?? data;
  return Array.isArray(profile?.plotTasks) && profile.plotTasks.some(task => task.enabled !== false);
}

export async function runAdvancePreset({ state, card, data, worldbook, advanceWorldbooks, text, callModel, signal, emit, trace, mapConcurrent, planRequest, memoryContext }) {
  const profile = data?.plotSettings ?? data;
  if (!Array.isArray(profile?.plotTasks)) return null;
  const tasks = profile.plotTasks.filter(task => task.enabled !== false).map((task, index) => ({ ...task, stage: Math.max(1, Number(task.stage) || 1), order: Number(task.order) || 0, id: task.id ?? String(index) })).sort((a, b) => a.stage - b.stage || a.order - b.order);
  const prior = state.advance?.profileId === state.legacyId ? state.advance : null;
  const declared = new Set(tasks.flatMap(task => [...names(task.extractTags), ...names(task.extractInjectTags)]).map(name => name.toLowerCase()));
  const tables = describeTables(state.tables);
  const summaries = summaryIndex(tables);
  const history = effectiveMessages(state).filter(message => message.role === 'assistant' && !message.hidden);
  const contextFor = options => {
    const count = Math.max(0, Number(options.contextTurnCount ?? 1));
    return (count ? history.slice(-count) : []).map(message => filterAdvanceContext(message.content, options, true)).join('\n\n');
  };
  const replacements = {
    '$5': JSON.stringify(hasSummarySelection(data) ? summaries.index : tables.map(({ name, headers, rows }) => ({ name, headers, rows }))),
    '$6': prior?.content ?? '', '$7': contextFor(profile),
    '$8': text, '$U': state.persona ?? '', '$C': card.description ?? '',
    sulv1: profile.rateMain ?? 1, sulv2: profile.ratePersonal ?? 1, sulv3: profile.rateErotic ?? 0, sulv4: profile.rateCuckold ?? 1, zhaohui: profile.recallCount ?? 20,
  };
  const replace = (content, values, relay, resolveTags = true, options = profile) => String(content ?? '').replace(/(?<!\\)\$[A-Za-z0-9_]+|\b(?:sulv[1-4]|zhaohui)\b|\{\{([^{}]+)\}\}/g, (whole, name) => {
    if (name) {
      if (!resolveTags) return whole;
      const found = lookup(relay, name) ?? lookup(prior?.tags ?? {}, name);
      return found ? block(name, found) : declared.has(name.toLowerCase()) ? block(name, []) : whole;
    }
    return Object.hasOwn(values, whole) ? filterAdvanceContext(values[whole], options) : whole;
  });
  const results = [];
  let plan;
  const selectedRecords = () => [...new Map(results.flatMap(result => summaries.retrieve(result.selectedRecords ?? [])).map(record => [JSON.stringify([record.tableId, record.recordId]), record])).values()];
  for (const task of tasks) {
    const relay = aggregate(results);
    const summaryRecords = selectedRecords();
      const tagNames = [...new Set([...names(task.extractInjectTags), ...names(task.extractTags)])];
      if (tagNames.some(name => !/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name))) throw new ProtocolError(`推进任务「${task.name}」的标签名无效`);
      const recallTag = tagNames.find(name => name.toLowerCase() === 'recall');
      const summaryOnly = !!recallTag && tagNames.length === 1;
      const sections = Object.fromEntries(tagNames.map(name => [name, { type: 'string', minLength: name === recallTag ? 0 : 1 }]));
      const schema = { type: 'object', properties: tagNames.length ? { sections: { type: 'object', properties: sections, required: tagNames, additionalProperties: false } } : { content: { type: 'string', minLength: 1 } }, required: [tagNames.length ? 'sections' : 'content'], additionalProperties: false };
      if (recallTag) { schema.properties.selectedRecords = summaries.selectionSchema; schema.required.push('selectedRecords'); }
      const options = { ...profile, ...Object.fromEntries(Object.entries(task).filter(([, value]) => value !== undefined)) };
      const plotConfig = options.plotWorldbookConfig;
      const bookSource = plotConfig?.source || options.worldbookSource;
      const selectedBooks = plotConfig?.manualSelection || options.selectedWorldbooks || [];
      const disabled = new Set(Array.isArray(options.disabledWorldbookEntries) ? options.disabledWorldbookEntries.map(String) : []);
      const candidates = options.worldbookEnabled === false ? [] : advanceWorldbooks && bookSource
        ? selectAdvanceWorldbooks(advanceWorldbooks, options).flatMap(book => book.entries)
        : worldbook.filter(entry => bookSource === 'manual' ? selectedBooks.includes(entry.world) : bookSource !== 'character' || entry.id.startsWith('card:'));
      const books = candidates.filter(entry => {
        const selected = plotConfig?.enabledEntries?.[entry.world];
        return (!Array.isArray(selected) || selected.includes(entry.originalId)) && !disabled.has(entry.id) && !disabled.has(String(entry.originalId));
      });
      const source = (task.promptGroup ?? []).filter(prompt => prompt.enabled !== false && typeof prompt.content === 'string');
      // Match shujuku's task-local scan: recent chat plus only tags this task
      // actually references. Unrelated old tasks must not activate more lore.
      const tagReferences = new Set(source.flatMap(prompt => [...prompt.content.matchAll(/\{\{([^{}]+)\}\}/g)].map(match => match[1].toLowerCase())));
      const scanLimit = Number(options.plotWorldbookScanMessageLimit ?? Math.max(1, Number(options.contextTurnCount ?? 3)));
      const scanHistory = scanLimit > 0 ? effectiveMessages(state).slice(-scanLimit) : [];
      const tagContext = Object.entries({ ...prior?.tags, ...relay }).filter(([name]) => tagReferences.has(name.toLowerCase())).map(([name, values]) => block(name, values)).join('\n');
      const active = activateWorldbook(books, { messages: [...scanHistory, { content: `${text}\n${tagContext}` }], turn: state.turn, history: state.worldActivation, settings: state.worldbookSettings }).entries;
      // Keep explicit source exclusions. Combination-selected entries from the
      // allowed books may supplement keyword activation, as in the ordinary planner.
      const withPlan = !!planRequest && task === tasks.at(-1) && !summaryOnly
        && planRequest.worldbook.every(entry => books.some(other => other.enabled && other.id === entry.id && other.content === entry.content));
      if (withPlan) { schema.properties.plan = planRequest.schema; schema.required.push('plan'); }
      const values = { ...replacements, '$1': summaryOnly ? JSON.stringify(worldbookDirectory(stableFirst(active))) : stableFirst(active).map(entry => entry.content).join('\n\n'), '$7': contextFor(options) };
      const bookParts = { fixed: filterAdvanceContext(active.filter(staticEntry).map(entry => entry.content).join('\n\n'), options), dynamic: filterAdvanceContext(active.filter(entry => !staticEntry(entry)).map(entry => entry.content).join('\n\n'), options) };
      let messages = await advanceMessages({ source, values,
        bookParts: !summaryOnly && Object.values(bookParts).filter(Boolean).join('\n\n') === filterAdvanceContext(values.$1, options) ? bookParts : null,
        replace: (content, substitutions, references) => replace(content, substitutions, references, true, options),
        relay: Object.fromEntries([...declared].map(name => [name, lookup(relay, name) ?? lookup(prior?.tags ?? {}, name) ?? []])),
        env: environmentFor(state, card), tables, signal, timeout: state.config.templateTimeout });
      if (summaryRecords.length && (withPlan || source.some(prompt => /(?<!\\)\$5\b|\{\{\s*recall\s*\}\}/i.test(prompt.content)))) messages.push({ role: 'system', content: JSON.stringify({ summaryRecords }) });
      const instruction = tagNames.length
        ? `按任务指令生成内容。输出协议为 JSON 对象 sections，键为 ${tagNames.join('、')}；每个值是原任务中对应标签内部的完整文本，保留其嵌套格式。所有字段都必须提供。原任务的 XML 外层标签由程序按字段名添加。`
        : '按任务指令生成内容，将完整结果放在 JSON 字段 content 中。';
      messages.push({ role: 'system', content: instruction, cacheStatic: true });
      if (recallTag) messages.push({ role: 'system', content: `纪要选择使用 JSON 字段 selectedRecords，格式为 [{"tableId":"索引中的表标识","recordIds":["该表 recordIdColumn 对应的精确字符串值"]}]。仅选择本轮相关的已有记录，完整纪要由程序按表与编码回取。sections.${recallTag} 保留对应标签内的文本，程序仅按 selectedRecords 决定选择。无索引或无相关记录时 selectedRecords 为 []，sections.${recallTag} 可为 ""；仅此空召回结果豁免最低长度，保持真实空选择。`, cacheStatic: true });
      if (summaryOnly) messages.push({ role: 'system', content: '本任务只选择已有纪要。世界资料以条目目录提供，用于理解专名；根据纪要索引、本轮输入与已有正文选择记录，不需要重述世界资料。', cacheStatic: true });
      if (memoryContext?.length && task === tasks.findLast(task => !names(task.extractTags).some(name => name.toLowerCase() === 'recall'))) {
        messages.push({ role: 'system', content: '独立角色记忆是本轮补充参考。保留角色知识边界，不把旧经历当成本轮发生的事件；依照原推进任务输出。', cacheStatic: true });
        messages.push({ role: 'user', content: JSON.stringify({ characterMemories: memoryContext }) });
      }
      if (withPlan) {
        messages.unshift(...(planRequest.messages ?? []));
        messages.push({ role: 'system', content: `${planRequest.instruction}\n在同一次结果中额外返回 plan，按给定结构填写本轮推进计划，并与本任务的 sections/content 保持一致。已有任务结果是参考材料，计划不是已发生事实。planningContext 中的 {$tavernContext:名称} 引用同名的 tavern-context 资料，内容在本请求只提供一次。`, cacheStatic: true });
        const included = new Set(source.some(prompt => /(?<!\\)\$1\b/.test(prompt.content)) ? active.map(entry => entry.id) : []);
        const missing = planRequest.worldbook.filter(entry => !included.has(entry.id));
        messages.push({ role: 'user', content: JSON.stringify(referenceExistingContext({ planningContext: planRequest.input, ...(missing.length ? { worldbook: missing.map(({ id, content }) => ({ id, content })) } : {}), priorTasks: results.map(advanceResultView) }, messages)) });
      }
      const contentOf = output => tagNames.length ? tagNames.map(name => block(name, [output.sections[name]])).join('\n\n') : output.content;
      const minimum = Number(task.minLength ?? profile.minLength ?? 0);
      const validate = output => {
        validateProtocol(output, schema);
        if (withPlan) planRequest.validate?.(output.plan);
        if (recallTag) {
          summaries.retrieve(output.selectedRecords);
          if (output.selectedRecords.length && !output.sections[recallTag].trim()) throw new ProtocolError('非空纪要选择须提供 recall 内容');
        }
        const emptyRecall = recallTag && tagNames.length === 1 && !output.selectedRecords.length && output.sections[recallTag] === '';
        const length = contentOf(output).length;
        if (!emptyRecall && length < minimum) throw new ProtocolError(`推进任务「${task.name}」内容长度不足（${length}/${minimum}）`);
      };
      messages = orderedToolMessages(messages);
      const agent = state.config.agents.advance, label = task.name || '推进子任务', usage = [], requests = [], startedAt = Date.now();
      emit({ type: 'stage', stage: 'advance', label, status: 'running', provider: agent.provider, model: agent.model });
      const repairContext = { taskName: label, minimumContentLength: minimum,
        ...(recallTag ? { summaryIndex: summaries.index } : {}),
        ...(withPlan ? { planningContext: Object.fromEntries(['scene', 'userInput', 'combination', 'recalls', 'worldState'].filter(key => Object.hasOwn(planRequest.input, key)).map(key => [key, planRequest.input[key]])) } : {}) };
      const output = await callModel({ sessionId: state.id, stage: 'advance', label, agent, messages, schema, signal, validate, repairContext, retries: state.config.protocolRetries, onUsage: value => usage.push(value), onRequest: value => requests.push(value) });
      validate(output);
      if (withPlan) plan = output.plan;
      const content = contentOf(output);
      const elapsedMs = Date.now() - startedAt;
      trace.push({ stage: 'advance', taskId: task.id, taskStage: task.stage, order: task.order, label, provider: agent.provider, model: agent.model, elapsedMs, usage, requests, result: output });
      emit({ type: 'stage', stage: 'advance', label, status: 'done', elapsedMs });
    results.push({ taskId: task.id, taskName: label, stage: task.stage, order: task.order, sections: output.sections ?? {}, injectOnly: names(task.extractInjectTags), content, ...(recallTag ? { selectedRecords: output.selectedRecords } : {}) });
  }
  const tags = aggregate(results), injectOnly = new Set(results.flatMap(result => result.injectOnly).map(name => name.toLowerCase()));
  const rawDirective = profile.prompts?.find(prompt => prompt.id === 'finalSystemDirective')?.content || profile.finalSystemDirective || '';
  const used = new Set();
  const directive = replace(rawDirective, replacements, {}, false).replace(/\{\{([^{}]+)\}\}/g, (whole, name) => {
    const values = lookup(tags, name);
    if (!values) return declared.has(name.toLowerCase()) ? '' : whole;
    used.add(name.toLowerCase()); return block(name, values);
  });
  const tail = Object.entries(tags).filter(([name]) => !used.has(name.toLowerCase()) && !injectOnly.has(name.toLowerCase())).map(([name, values]) => block(name, values));
  if (!Object.keys(tags).length) tail.push(...results.map(result => result.content));
  const injection = [directive, ...tail].filter(Boolean).join('\n\n');
  state.advance = { profileId: state.legacyId, tags, content: results.map(result => result.content).join('\n\n') };
  return { results, injection, summaryRecords: selectedRecords(), ...(plan ? { plan } : {}) };
}
