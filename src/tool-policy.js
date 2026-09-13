// Purpose-specific inputs. The stored assets, activation decisions and writer
// messages are never changed by these views. `full` is the compatibility path.
export function focusedToolInput(stage, input, { mode = 'focused', turn = 0 } = {}) {
  if (mode === 'full') return input;
  if (stage === 'recall') {
    const { worldbook, staticWorldbook, activeWorldbook, ...rest } = input;
    // This job selects existing episode ids, not world lore or future events.
    return rest;
  }
  if (stage === 'combine') {
    const { activeWorldbook = [], staticWorldbook = [], ...rest } = input;
    const entries = [...staticWorldbook, ...activeWorldbook];
    const directory = new Map((input.worldbookDirectory ?? []).map(entry => [entry.id, entry]));
    // Unlabelled material cannot be routed from a directory. Keep its full text.
    const unlabelled = entries.filter(entry => {
      const label = directory.get(entry.id) ?? entry;
      return !label.title?.trim() && !label.keys?.some(key => String(key).trim());
    });
    return { ...rest, activeWorldEntryIds: entries.map(entry => entry.id),
      ...(unlabelled.length ? { unlabelledWorldbook: unlabelled } : {}) };
  }
  if (stage === 'table') {
    const populated = new Set((input.tableRows ?? []).filter(table => table.rows?.length).map(table => table.tableId));
    const initialization = [];
    const templates = (input.templates ?? []).map(template => {
      const { updateConfig, ...view } = template;
      // The DDL already contains types, keys, defaults and constraints. Preserve
      // the row/display mapping without repeating the SQLite PRAGMA metadata.
      if (template.instructions?.ddl?.trim()) view.columns = template.columns.map(({ name }) => ({ name }));
      if (template.instructions?.initNode) {
        const { initNode, ...instructions } = template.instructions;
        view.instructions = instructions;
        if (!populated.has(template.id)) initialization.push({ tableId: template.id, initNode });
      }
      return view;
    });
    // Whether a table is empty is dynamic. Its initialization rules must not
    // alter the stable template prefix shared with the next filled turn.
    return { ...input, templates, initialization };
  }
  return input;
}

export function toolScopeAllows(prompt, stage) {
  const scopes = prompt.toolStages ?? prompt.extensions?.tavernToolStages ?? prompt.extra?.raw?.extensions?.tavernToolStages;
  return Array.isArray(scopes) && (scopes.includes('*') || scopes.includes(stage));
}

export const focusedInstructions = {
  recall: '本任务只选择已存记忆，不需要读取世界书全文。角色设定用于辨认身份，不能替代已存经历或增加角色知识。',
  combine: '这是场景路由，不是世界规则解释器。worldbookDirectory 是候选目录，activeWorldEntryIds 是本轮实际激活的条目。按目录、既有正文、角色档案和独立记忆选择相关 id；不要从标题推测未提供的规则细节。完整规则由后续推进与写作读取。',
  table: 'templates 是固定的列定义、DDL、通用说明及插入/更新/删除规则。initialization 按 tableId 提供本轮空表的 initNode；已有行的表不再重复初始化。无需复述模板，直接返回有依据的变化及模板要求的初始化。',
};


// Minimal grounding for field repair, never the full imported prose preset.
export function toolRepairContext(stage, input) {
  const keys = {
    recall: ['character', 'maximumRecallCount', 'sceneHint', 'userInput', 'currentState'],
    combine: ['characters', 'scene', 'userInput', 'recalls', 'worldState', 'worldbookDirectory', 'activeWorldEntryIds'],
    memory: ['task', 'character', 'characters', 'characterStates', 'currentState', 'sourcePassages', 'completedStoryMessageId'],
    table: ['characters', 'currentWorldState', 'sourcePassages', 'completedStoryMessageId'],
  }[stage];
  if (!keys) return input;
  const context = Object.fromEntries(keys.filter(key => Object.hasOwn(input, key)).map(key => [key, input[key]]));
  if (stage === 'recall') context.allowedMemoryIds = (input.memories ?? []).map(memory => memory.id);
  if (stage === 'table') {
    context.tables = (input.templates ?? []).map(({ id, name, sqlName, headers, columns, keyColumn }) => ({ id, name, sqlName, headers, columns, keyColumn }));
    context.tableRows = input.tableRows;
  }
  return context;
}
