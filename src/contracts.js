import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
const text = { type: 'string' };
const texts = { type: 'array', items: text };
export const object = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const array = items => ({ type: 'array', items });
export const SCENE = object({ location: text, time: text, summary: text });
export const SEARCH_QUERY = object({ queries: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 300 } } });
const evidenceReference = object({ sourceId: { type: 'string', minLength: 1 } });
const stateChange = object({
  op: { type: 'string', enum: ['set', 'remove'] },
  target: { oneOf: [object({ id: { type: 'string', minLength: 1 } }), object({ subject: { type: 'string', minLength: 1 }, key: { type: 'string', minLength: 1 } })] },
  value: { type: ['string', 'null'] },
  evidence: evidenceReference,
});
export const RECALL = object({
  characterId: text,
  memories: array(object({ id: text, relevance: { type: 'number', minimum: 0, maximum: 1 } })),
  perspective: text, likelyPresent: { type: 'boolean' },
});
export const COMBINATION = object({
  scene: SCENE,
  presentCharacterIds: texts,
  worldEntryIds: texts,
  situation: text,
  characterViews: array(object({ characterId: text, knowledge: text, intent: text })),
  openThreads: texts,
});
export const PLAN = object({
  scene: SCENE, beats: texts,
  characterIntents: array(object({ characterId: text, intent: text, knowledgeBoundary: text })),
  constraints: texts,
});
export const MEMORY = object({
  characterId: text, summary: text, facts: texts, relationships: texts, openThreads: texts,
  stateChanges: array(stateChange),
});
export const TABLE_UPDATE = object({
  operations: array(object({
    table: text, op: { type: 'string', enum: ['insert', 'update', 'delete'] },
    rowId: { type: ['string', 'number', 'null'] },
    values: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean', 'null'] } },
  })),
  scene: SCENE,
  worldChanges: array(stateChange),
  participatingCharacters: array(object({ characterId: { type: 'string', minLength: 1 }, evidence: evidenceReference })),
  newCharacters: array(object({ name: { type: 'string', minLength: 1 }, profile: text, evidence: evidenceReference })),
});
export const ROSTER = object({ characters: array(object({ name: text, profile: text, worldbookIds: texts })) });

const validators = new WeakMap();
export class ProtocolError extends Error { constructor(message) { super(message); this.name = 'ProtocolError'; } }

export function validateProtocol(value, schema) {
  let validate = validators.get(schema);
  if (!validate) { validate = ajv.compile(schema); ajv.removeSchema(schema); validators.set(schema, validate); }
  if (!validate(value)) throw new ProtocolError(ajv.errorsText(validate.errors, { separator: '; ' }));
  return value;
}

export function decodeProtocol(response, schema, mode = 'tool') {
  let value;
  try {
    if (mode === 'tool') {
      const calls = response.toolCalls;
      if (calls.length !== 1 || calls[0].name !== 'tavern_result') throw new ProtocolError('需要且只能调用一次 tavern_result');
      value = JSON.parse(calls[0].arguments);
    } else {
      const matches = [...response.text.matchAll(/<tavern_result>\s*([\s\S]*?)\s*<\/tavern_result>/g)];
      if (matches.length !== 1) throw new ProtocolError('需要且只能包含一个 <tavern_result> JSON 协议块');
      value = JSON.parse(matches[0][1]);
    }
  } catch (error) { if (error instanceof ProtocolError) throw error; throw new ProtocolError(`JSON 解码失败：${error.message}`); }
  return validateProtocol(value, schema);
}

export const ROLE_INSTRUCTIONS = {
  recall: '你负责一个角色的独立记忆召回。只从提供的该角色记忆中选择与当前输入、场景相关的记录。以该角色可知的信息形成简短视角，不把其他角色的私密经历变成自己的记忆。返回输入 memories 列表中记录的精确 id 和相关度；currentState 的条目 id 属于状态记录，不能作为 memories 的 id 返回。无相关经历时返回空数组。currentState 是该角色最后确认的状态，旧经历保留当时的信息，不能据此覆盖后来的变化。sceneHint 和 userInput 用于检索，不代表角色已经获知这些信息。',
  combine: '你负责组合并行召回结果，确定当前场景、在场角色和本轮相关世界书条目。区分各角色已知与未知的信息、已发生事实与计划。只能引用目录提供的角色 id 和世界书 id。worldState 是最后确认的世界状态，worldEpisodes 是有时间顺序和出处的旧经历；旧经历不能覆盖较新的状态。世界资料仅供叙述者核对，不自动变成角色知识。不要提前写正文。',
  advance: '你负责本轮剧情推进设计。根据用户输入、当前场景、在场角色的独立记忆和意图，形成可供写作执行的情节节点与角色行动意图。characterIntents 只能引用 combination.presentCharacterIds 中的精确 id；其他人物的计划写入 beats。沿用已建立的因果、时间顺序和约束，不替用户擅自决定行动。设计不等于已经发生。',
  write: '',
  memory: '你负责一个角色的记忆更新。仅依据本轮用户输入与已完成正文，记录该角色经历、观察或明确获知的事实、关系和未解决事项。规划中未写入正文的事情不记录。其他角色的内心活动不自动成为此角色已知信息。概括时保留每项行为的主体、对象与完成状态，区分提出、同意和执行。内心想法与公开表达分别记录，信息获知按实际传达方向记录。previousMemories 只是检索片段，不代表完整经历。currentState 是最后确认的角色状态与知识。stateChanges 只记录本轮证实的新状态或变化（位置、身体、物品、关系、承诺、待办及角色获知的信息）；更新或移除已有属性时 target 只填该属性当前记录的 id，程序沿用其名称；仅新增属性时 target 填 subject/key。value 写为简短完整事实。移除已不成立且没有替代值的项用 remove/value:null。每项 evidence.sourceId 选择 sourcePassages 各组 passages 中能支持变化的原文段落 id，系统会按 id 保存原文。只记录这个角色可知的内容；未知的外界变化不能替他更新知识。没有新记忆时所有文本字段和列表为空。',
  table: '你负责按导入模板填表，并更新当前世界状态。保留所有列、行标识、默认值、字段约束及模板说明。只根据本轮用户输入与已完成正文提出实际变化，不能把推进计划当作事实。概括时保留每项行为的主体、对象与完成状态，区分提出、同意和执行。内心想法与公开表达分别记录，信息获知按实际传达方向记录。插入时 values 使用列名；更新和删除时 rowId 为原行标识。模板中的 SQL 示例用来理解字段与约束，本次通过 JSON operations 表达更新。worldChanges 保存正文确认的角色实际状态、场景和世界变化（时间地点、物品归属、设施、事件进展和未解决事项），与角色是否知情分开。更新或移除已有属性时 target 只填 currentWorldState 中该属性当前记录的 id，程序沿用其名称；仅新增属性时 target 填 subject/key。value 为简短完整事实。失效且无替代值的项用 remove/value:null。evidence.sourceId 选择 sourcePassages 各组 passages 中支持变化的原文段落 id，系统会按 id 保存原文。没有变化则返回空 operations/worldChanges。',
  roster: '从提供的角色卡和世界书建立角色目录。每个实际角色独立成项，记录名称、基础设定和描述该角色的世界书 id。不要把组织、地点或概念列为角色。只能引用提供的世界书 id。',
};
for (const stage of ['recall', 'combine', 'memory', 'table']) ROLE_INSTRUCTIONS[stage] += ' 当前状态只列出本轮相关项，未列出的项仍保存在完整状态记录中。';
for (const stage of ['memory', 'table']) ROLE_INSTRUCTIONS[stage] += ' sourcePassages 按消息分组，每组只有一个 messageId，其 passages 按原文顺序保存完整的 {id,quote} 段落。messageId 等于 completedStoryMessageId 的一组就是已完成正文，不另行重复全文。';
ROLE_INSTRUCTIONS.table += ' templates 提供表结构、列名、约束和说明；tableRows 提供当前行，按 tableId 对应 templates 的 id。';
ROLE_INSTRUCTIONS.combine += ' 记忆中没有记录不代表当下无法观察或交流；尚未告知只表示既有信息差，角色意图仍须依据其设定与当前情境判断。';
ROLE_INSTRUCTIONS.advance += ' 随情节节点更新角色知识：角色能够听懂本轮已经说出的信息，并通过观察确认变化，不能把开场时的未知固定到整轮结束。';
ROLE_INSTRUCTIONS.table += ' participatingCharacters 列出 characters 中 enabled 为 true 且在本轮已完成正文中实际经历、观察或明确获知事件的角色，每个 characterId 只出现一次，包括本轮首次参与的已有角色；仅被提及、出现在计划中或未获知事件的角色不列入，无参与者时返回空数组。每项 evidence.sourceId 必须引用 sourcePassages 中 messageId 等于 completedStoryMessageId 那一组 passages 内支持该角色实际参与的原文段落。newCharacters 仅补录本轮正文首次实际出场的具名非玩家角色，并提供支持其身份与基础设定的正文原文依据；已经在 characters 中的角色沿用原身份，不重复创建，未出场的计划角色不补录。';

for (const stage of ['recall', 'combine', 'roster']) ROLE_INSTRUCTIONS[stage] += ' staticWorldbook 与 worldbook/activeWorldbook 合在一起是本次提供的世界资料，条目均保留原 id；分开排列只为复用固定前缀。';

export function defaultConfig(route = {}) {
  const models = {};
  for (const key of ['recall', 'combine', 'advance', 'write', 'memory', 'table']) {
    models[key] = { provider: route.provider ?? '', model: route.model ?? '', reasoningEffort: '', temperature: key === 'write' ? null : 0.5, maxTokens: null, protocol: 'tool', prompt: '', presetId: '' };
  }
  return { playMode: 'agent', normalMaxInputTokens: 200000, agents: models, concurrency: 4, historyTurns: 12, recallCount: 8, recallBatchSize: 48, protocolRetries: 3, templateTimeout: 8000 };
}

export function validateConfig(config) {
  config.playMode ??= 'agent';
  config.normalMaxInputTokens ??= 200000;
  for (const key of ['recall', 'combine', 'advance', 'write', 'memory', 'table']) if (config.agents?.[key]) config.agents[key].presetId ??= '';
  const properties = {
    playMode: { type: 'string', enum: ['agent', 'normal'] },
    normalMaxInputTokens: { type: 'integer', minimum: 1 },
    agents: object(Object.fromEntries(['recall', 'combine', 'advance', 'write', 'memory', 'table'].map(key => [key, object({
      provider: text, model: text, reasoningEffort: text, temperature: { type: ['number', 'null'], minimum: 0, maximum: 2 },
      maxTokens: { type: ['integer', 'null'], minimum: 1, maximum: 1000000 }, protocol: { type: 'string', enum: ['tool', 'json'] }, prompt: text, presetId: text,
    })]))),
    concurrency: { type: 'integer', minimum: 1, maximum: 16 }, historyTurns: { type: 'integer', minimum: 1, maximum: 1000 },
    recallCount: { type: 'integer', minimum: 1, maximum: 100 }, recallBatchSize: { type: 'integer', minimum: 1, maximum: 1000 },
    protocolRetries: { type: 'integer', minimum: 0, maximum: 3 }, templateTimeout: { type: 'integer', minimum: 1000, maximum: 30000 },
  };
  return validateProtocol(config, object(properties));
}
