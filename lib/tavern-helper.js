var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// node_modules/klona/dist/index.mjs
function klona2(x) {
  if (typeof x !== "object") return x;
  var k, tmp, str = Object.prototype.toString.call(x);
  if (str === "[object Object]") {
    if (x.constructor !== Object && typeof x.constructor === "function") {
      tmp = new x.constructor();
      for (k in x) {
        if (x.hasOwnProperty(k) && tmp[k] !== x[k]) {
          tmp[k] = klona2(x[k]);
        }
      }
    } else {
      tmp = {};
      for (k in x) {
        if (k === "__proto__") {
          Object.defineProperty(tmp, k, {
            value: klona2(x[k]),
            configurable: true,
            enumerable: true,
            writable: true
          });
        } else {
          tmp[k] = klona2(x[k]);
        }
      }
    }
    return tmp;
  }
  if (str === "[object Array]") {
    k = x.length;
    for (tmp = Array(k); k--; ) {
      tmp[k] = klona2(x[k]);
    }
    return tmp;
  }
  if (str === "[object Set]") {
    tmp = /* @__PURE__ */ new Set();
    x.forEach(function(val) {
      tmp.add(klona2(val));
    });
    return tmp;
  }
  if (str === "[object Map]") {
    tmp = /* @__PURE__ */ new Map();
    x.forEach(function(val, key) {
      tmp.set(klona2(key), klona2(val));
    });
    return tmp;
  }
  if (str === "[object Date]") {
    return /* @__PURE__ */ new Date(+x);
  }
  if (str === "[object RegExp]") {
    tmp = new RegExp(x.source, x.flags);
    tmp.lastIndex = x.lastIndex;
    return tmp;
  }
  if (str === "[object DataView]") {
    return new x.constructor(klona2(x.buffer));
  }
  if (str === "[object ArrayBuffer]") {
    return x.slice(0);
  }
  if (str.slice(-6) === "Array]") {
    return new x.constructor(x);
  }
  return x;
}

// vendor/tavern-helper/src/function/preset.ts
var preset_exports = {};
__export(preset_exports, {
  createOrReplacePreset: () => createOrReplacePreset,
  createPreset: () => createPreset,
  default_preset: () => default_preset,
  deletePreset: () => deletePreset,
  getLoadedPresetName: () => getLoadedPresetName,
  getPreset: () => getPreset,
  getPresetNames: () => getPresetNames,
  isPresetNormalPrompt: () => isPresetNormalPrompt,
  isPresetPlaceholderPrompt: () => isPresetPlaceholderPrompt,
  isPresetSystemPrompt: () => isPresetSystemPrompt,
  loadPreset: () => loadPreset,
  renamePreset: () => renamePreset,
  replacePreset: () => replacePreset,
  setPreset: () => setPreset,
  updatePresetWith: () => updatePresetWith
});

// vendor/tavern-helper/src/function/tavern_regex.ts
var tavern_regex_exports = {};
__export(tavern_regex_exports, {
  formatAsTavernRegexedString: () => formatAsTavernRegexedString,
  from_tavern_regex: () => from_tavern_regex,
  getTavernRegexes: () => getTavernRegexes,
  get_tavern_regexes_without_clone: () => get_tavern_regexes_without_clone,
  isCharacterTavernRegexesEnabled: () => isCharacterTavernRegexesEnabled,
  render_tavern_regexes: () => render_tavern_regexes,
  render_tavern_regexes_debounced: () => render_tavern_regexes_debounced,
  replaceTavernRegexes: () => replaceTavernRegexes,
  to_tavern_regex: () => to_tavern_regex,
  updateTavernRegexesWith: () => updateTavernRegexesWith
});

// vendor/tavern-helper/host/world-info.js
var GENERATION_TYPE_TRIGGERS = [
  "normal",
  "continue",
  "impersonate",
  "swipe",
  "regenerate",
  "quiet"
];
var world_info_logic = {
  AND_ANY: 0,
  NOT_ALL: 1,
  NOT_ANY: 2,
  AND_ALL: 3
};
var DEFAULT_DEPTH = 4;
var DEFAULT_WEIGHT = 100;
var world_info_position = {
  before: 0,
  after: 1,
  ANTop: 2,
  ANBottom: 3,
  atDepth: 4,
  EMTop: 5,
  EMBottom: 6,
  outlet: 7
};
function parseRegexFromString(input) {
  let match = input.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
  if (!match) {
    return null;
  }
  let [, pattern, flags] = match;
  if (pattern.match(/(^|[^\\])\//)) {
    return null;
  }
  pattern = pattern.replace("\\/", "/");
  try {
    return new RegExp(pattern, flags);
  } catch (e2) {
    return null;
  }
}
var newWorldInfoEntryDefinition = {
  key: { default: [], type: "array" },
  keysecondary: { default: [], type: "array" },
  comment: { default: "", type: "string" },
  content: { default: "", type: "string" },
  constant: { default: false, type: "boolean" },
  vectorized: { default: false, type: "boolean" },
  selective: { default: true, type: "boolean" },
  selectiveLogic: { default: world_info_logic.AND_ANY, type: "enum" },
  addMemo: { default: false, type: "boolean" },
  order: { default: 100, type: "number" },
  position: { default: 0, type: "number" },
  disable: { default: false, type: "boolean" },
  ignoreBudget: { default: false, type: "boolean" },
  excludeRecursion: { default: false, type: "boolean" },
  preventRecursion: { default: false, type: "boolean" },
  matchPersonaDescription: { default: false, type: "boolean" },
  matchCharacterDescription: { default: false, type: "boolean" },
  matchCharacterPersonality: { default: false, type: "boolean" },
  matchCharacterDepthPrompt: { default: false, type: "boolean" },
  matchScenario: { default: false, type: "boolean" },
  matchCreatorNotes: { default: false, type: "boolean" },
  delayUntilRecursion: { default: 0, type: "number" },
  probability: { default: 100, type: "number" },
  useProbability: { default: true, type: "boolean" },
  depth: { default: DEFAULT_DEPTH, type: "number" },
  outletName: { default: "", type: "string" },
  group: { default: "", type: "string" },
  groupOverride: { default: false, type: "boolean" },
  groupWeight: { default: DEFAULT_WEIGHT, type: "number" },
  scanDepth: { default: null, type: "number?" },
  caseSensitive: { default: null, type: "boolean?" },
  matchWholeWords: { default: null, type: "boolean?" },
  useGroupScoring: { default: null, type: "boolean?" },
  automationId: { default: "", type: "string" },
  role: { default: 0, type: "enum" },
  sticky: { default: null, type: "number?" },
  cooldown: { default: null, type: "number?" },
  delay: { default: null, type: "number?" },
  characterFilterNames: { default: [], type: "array", excludeFromTemplate: true },
  characterFilterTags: { default: [], type: "array", excludeFromTemplate: true },
  characterFilterExclude: { default: false, type: "boolean", excludeFromTemplate: true },
  triggers: { default: [], type: "array", arrayFilter: (value) => GENERATION_TYPE_TRIGGERS.includes(value) }
};
var newWorldInfoEntryTemplate = Object.fromEntries(
  Object.entries(newWorldInfoEntryDefinition).filter(([_2, value]) => !value.excludeFromTemplate).map(([key, value]) => [key, value.default])
);

// src/helper-host.js
var host = window.__tavernHelperHost;
var context = host.context;
var chat = context.chat;
var characters = context.characters;
var extension_settings = context.extension_settings;
var eventSource = context.eventSource;
var event_types = context.event_types;
var this_chid = 0;
var version = context.version;
var saveSettings = () => host.saveSettings();
var saveSettingsDebounced = () => host.saveSettings().catch(host.report);
var substituteParams = (text) => host.substituteParams(text);
var substituteParamsExtended = substituteParams;
var getCurrentChatId = () => context.chatId;
var uuidv4 = () => crypto.randomUUID();
var promptManager = host.promptManager;
var oai_settings = host.oaiSettings;
var preset_manager = host.presetManager;
var getCompletionPresetByName = (name) => host.getPreset(name);
var getRegexedString = (text, placement, options) => host.regex(text, placement, options);
var regex_placement = { USER_INPUT: 1, AI_OUTPUT: 2, SLASH_COMMAND: 3, WORLD_INFO: 5, REASONING: 6 };
var writeExtensionField = (id, key, value) => host.writeExtensionField(id, key, value);
var refreshOneMessage = (index) => host.refreshOneMessage(index);
var macros = [];
var RawCharacter = { findIndex: (name) => name === "current" || name === context.name2 ? 0 : -1 };
function _getButtonEvent(name) {
  return host.getButtonEvent(this, name);
}
var getTavernHelperExtensionId = () => "N0VI028/JS-Slash-Runner";
var updateExtension = async (id) => {
  if (id !== getTavernHelperExtensionId()) throw new Error("\u672A\u8FDE\u63A5\u8BE5\u6269\u5C55\u7684\u66F4\u65B0\u670D\u52A1");
  await host.update();
  return new Response(null, { status: 200 });
};
var extension_prompt_roles = { SYSTEM: 0, USER: 1, ASSISTANT: 2 };
var world_names = new Proxy(host.getWorldbookNames(), { get: (_names, key) => Reflect.get(host.getWorldbookNames(), key) });
var loadWorldInfo = (name) => host.loadWorldInfo(name);
var saveWorldInfo = (name, data) => host.saveWorldInfo(name, data);
function createNewWorldInfo() {
  throw new Error("\u5F53\u524D\u5BBF\u4E3B\u672A\u8FDE\u63A5\u521B\u5EFA\u4E16\u754C\u4E66\u63A5\u53E3");
}
var selected_world_info = host.selectedWorldbooks;

// vendor/tavern-helper/src/function/tavern_regex.ts
function formatAsTavernRegexedString(text, source, destination, { depth, character_name } = {}) {
  let result = getRegexedString(
    text,
    {
      user_input: regex_placement.USER_INPUT,
      ai_output: regex_placement.AI_OUTPUT,
      slash_command: regex_placement.SLASH_COMMAND,
      world_info: regex_placement.WORLD_INFO,
      reasoning: regex_placement.REASONING
    }[source],
    {
      characterOverride: character_name,
      isMarkdown: destination === "display",
      isPrompt: destination === "prompt",
      depth
    }
  );
  result = substituteParams(result, void 0, character_name, void 0, void 0);
  macros.forEach((macro) => {
    result = result.replace(
      macro.regex,
      (substring, ...args) => macro.replace(
        {
          role: {
            user_input: "user",
            ai_output: "assistant",
            slash_command: "system",
            world_info: "system",
            reasoning: "system"
          }[source],
          message_id: depth !== void 0 ? chat.length - depth - 1 : void 0
        },
        substring,
        ...args
      )
    );
  });
  return result;
}
function get_tavern_regexes_without_clone(option) {
  let data;
  switch (option.type) {
    case "global":
      data = extension_settings.regex ?? [];
      break;
    case "character": {
      const id = RawCharacter.findIndex(option.name ?? "current");
      data = characters.at(id)?.data?.extensions?.regex_scripts ?? [];
      break;
    }
    case "preset": {
      option.name ??= "in_use";
      const preset = option.name === "in_use" ? oai_settings : getCompletionPresetByName(option.name);
      data = preset?.extensions?.regex_scripts ?? [];
      break;
    }
  }
  return data.map(to_tavern_regex);
}
function to_tavern_regex(regex_script_data) {
  return {
    id: regex_script_data.id,
    script_name: regex_script_data.scriptName,
    enabled: !regex_script_data.disabled,
    find_regex: regex_script_data.findRegex,
    trim_strings: regex_script_data.trimStrings || [],
    replace_string: regex_script_data.replaceString,
    source: {
      user_input: regex_script_data.placement.includes(regex_placement.USER_INPUT),
      ai_output: regex_script_data.placement.includes(regex_placement.AI_OUTPUT),
      slash_command: regex_script_data.placement.includes(regex_placement.SLASH_COMMAND),
      world_info: regex_script_data.placement.includes(regex_placement.WORLD_INFO),
      reasoning: regex_script_data.placement.includes(regex_placement.REASONING)
    },
    destination: {
      display: regex_script_data.markdownOnly,
      prompt: regex_script_data.promptOnly
    },
    run_on_edit: regex_script_data.runOnEdit,
    min_depth: typeof regex_script_data.minDepth === "number" ? regex_script_data.minDepth : null,
    max_depth: typeof regex_script_data.maxDepth === "number" ? regex_script_data.maxDepth : null
  };
}
function from_tavern_regex(tavern_regex) {
  return {
    id: tavern_regex.id,
    scriptName: tavern_regex.script_name,
    disabled: !tavern_regex.enabled,
    runOnEdit: tavern_regex.run_on_edit,
    findRegex: tavern_regex.find_regex,
    trimStrings: tavern_regex.trim_strings || [],
    replaceString: tavern_regex.replace_string,
    placement: [
      ...tavern_regex.source.user_input ? [regex_placement.USER_INPUT] : [],
      ...tavern_regex.source.ai_output ? [regex_placement.AI_OUTPUT] : [],
      ...tavern_regex.source.slash_command ? [regex_placement.SLASH_COMMAND] : [],
      ...tavern_regex.source.world_info ? [regex_placement.WORLD_INFO] : [],
      ...tavern_regex.source.reasoning ? [regex_placement.REASONING] : []
    ],
    substituteRegex: 0,
    // TODO: handle this?
    // @ts-expect-error 类型是正确的
    minDepth: tavern_regex.min_depth,
    // @ts-expect-error 类型是正确的
    maxDepth: tavern_regex.max_depth,
    markdownOnly: tavern_regex.destination.display,
    promptOnly: tavern_regex.destination.prompt
  };
}
function isCharacterTavernRegexesEnabled() {
  return extension_settings?.character_allowed_regex?.includes(
    characters.at(Number(this_chid))?.avatar ?? ""
  );
}
function getTavernRegexes(option) {
  if (option?.type === void 0) {
    option ??= { type: "global" };
    const { scope = "all", enable_state = "all" } = option;
    if (!["all", "enabled", "disabled"].includes(enable_state)) {
      throw Error(`\u63D0\u4F9B\u7684 enable_state \u65E0\u6548, \u8BF7\u63D0\u4F9B 'all', 'enabled' \u6216 'disabled', \u4F60\u63D0\u4F9B\u7684\u662F: ${enable_state}`);
    }
    if (!["all", "global", "character"].includes(scope)) {
      throw Error(`\u63D0\u4F9B\u7684 scope \u65E0\u6548, \u8BF7\u63D0\u4F9B 'all', 'global' \u6216 'character', \u4F60\u63D0\u4F9B\u7684\u662F: ${scope}`);
    }
    let regexes = [];
    if (scope === "all" || scope === "global") {
      regexes = [
        ...regexes,
        ...get_tavern_regexes_without_clone({ type: "global" }).map((regex) => ({ ...regex, scope: "global" }))
      ];
    }
    if (scope === "all" || scope === "character") {
      regexes = [
        ...regexes,
        ...get_tavern_regexes_without_clone({ type: "character" }).map((regex) => ({ ...regex, scope: "character" }))
      ];
    }
    if (enable_state !== "all") {
      regexes = regexes.filter((regex) => regex.enabled === (enable_state === "enabled"));
    }
    return klona(regexes);
  }
  return klona(get_tavern_regexes_without_clone(option));
}
async function render_tavern_regexes() {
  await saveSettings();
  await Promise.all(
    $("#chat > .mes").map((_index, element) => {
      return refreshOneMessage(Number($(element).attr("mesid")));
    })
  );
  await eventSource.emit(event_types.CHAT_CHANGED, getCurrentChatId());
}
var render_tavern_regexes_debounced = _.debounce(render_tavern_regexes, 1e3);
async function replaceTavernRegexes(regexes, option) {
  regexes.filter((regex) => regex.script_name == "").forEach((regex) => {
    regex.script_name = `\u672A\u547D\u540D-${regex.id}`;
  });
  if (option?.type === void 0) {
    option ??= { type: "global" };
    const { scope = "all" } = option;
    if (!["all", "global", "character"].includes(scope)) {
      throw Error(`\u63D0\u4F9B\u7684 scope \u65E0\u6548, \u8BF7\u63D0\u4F9B 'all', 'global' \u6216 'character', \u4F60\u63D0\u4F9B\u7684\u662F: ${scope}`);
    }
    const [global_regexes, character_regexes] = _.partition(regexes, (regex) => regex.scope === "global").map(
      (paritioned) => paritioned.map(from_tavern_regex)
    );
    const character = characters.at(this_chid);
    if (scope === "all" || scope === "global") {
      extension_settings.regex = global_regexes;
    }
    if (scope === "all" || scope === "character") {
      if (!character) {
        return;
      }
      await writeExtensionField(this_chid, "regex_scripts", character_regexes);
    }
    return render_tavern_regexes_debounced();
  }
  const converted = regexes.map(from_tavern_regex);
  switch (option.type) {
    case "global":
      extension_settings.regex = converted;
      break;
    case "preset": {
      option.name ??= "in_use";
      if (option.name !== "in_use" && !preset_manager.getAllPresets().includes(option.name)) {
        return;
      }
      if (option.name === "in_use") {
        _.set(oai_settings, "extensions.regex_scripts", converted);
        saveSettingsDebounced();
      } else {
        const data = getCompletionPresetByName(option.name);
        _.set(data, "extensions.regex_scripts", converted);
        await preset_manager.savePreset(option.name, data, { skipUpdate: true });
      }
      break;
    }
    case "character": {
      const id = RawCharacter.findIndex(option.name ?? "current");
      if (id === -1) {
        const errorMsg = `\u672A\u80FD\u627E\u5230\u89D2\u8272 '${option.name ?? "current"}'`;
        toastr.error(errorMsg, "\u89D2\u8272\u4E0D\u5B58\u5728");
        throw Error(errorMsg);
      }
      const character = characters.at(id);
      if (!character) {
        return;
      }
      await writeExtensionField(String(id), "regex_scripts", converted);
      break;
    }
  }
  return render_tavern_regexes_debounced();
}
async function updateTavernRegexesWith(updater, option) {
  let regexes = getTavernRegexes(option);
  regexes = await updater(regexes);
  await replaceTavernRegexes(regexes, option);
  return regexes;
}

// vendor/tavern-helper/src/util/compatibility.ts
function fromCharacterBook(character_book) {
  const result = { entries: {} };
  character_book.entries.forEach((entry, index) => {
    if (entry.id === void 0) {
      entry.id = index;
    }
    result.entries[entry.id] = {
      ...newWorldInfoEntryTemplate,
      uid: entry.id,
      key: entry.keys,
      keysecondary: entry.secondary_keys || [],
      comment: entry.comment || "",
      content: entry.content,
      constant: entry.constant || false,
      selective: entry.selective || false,
      order: entry.insertion_order,
      position: entry.extensions?.position ?? (entry.position === "before_char" ? world_info_position.before : world_info_position.after),
      excludeRecursion: entry.extensions?.exclude_recursion ?? false,
      preventRecursion: entry.extensions?.prevent_recursion ?? false,
      delayUntilRecursion: entry.extensions?.delay_until_recursion ?? false,
      disable: !entry.enabled,
      addMemo: !!entry.comment,
      displayIndex: entry.extensions?.display_index ?? index,
      probability: entry.extensions?.probability ?? 100,
      useProbability: entry.extensions?.useProbability ?? true,
      depth: entry.extensions?.depth ?? DEFAULT_DEPTH,
      selectiveLogic: entry.extensions?.selectiveLogic ?? world_info_logic.AND_ANY,
      group: entry.extensions?.group ?? "",
      groupOverride: entry.extensions?.group_override ?? false,
      groupWeight: entry.extensions?.group_weight ?? DEFAULT_WEIGHT,
      scanDepth: entry.extensions?.scan_depth ?? null,
      caseSensitive: entry.extensions?.case_sensitive ?? null,
      matchWholeWords: entry.extensions?.match_whole_words ?? null,
      useGroupScoring: entry.extensions?.use_group_scoring ?? null,
      automationId: entry.extensions?.automation_id ?? "",
      role: entry.extensions?.role ?? extension_prompt_roles.SYSTEM,
      vectorized: entry.extensions?.vectorized ?? false,
      sticky: entry.extensions?.sticky ?? null,
      cooldown: entry.extensions?.cooldown ?? null,
      delay: entry.extensions?.delay ?? null,
      extensions: entry.extensions ?? {}
    };
  });
  return result;
}
function reloadEditor(file, load_if_not_selected = false) {
  const current_index = Number($("#world_editor_select").val());
  const selected_index = world_names.indexOf(file);
  if (selected_index !== -1 && (load_if_not_selected || current_index === selected_index)) {
    $("#world_editor_select").val(selected_index).trigger("change");
  }
}
var reloadEditorDebounced = _.debounce(reloadEditor, 1e3);
var settingsToUpdate = {
  max_context_unlocked: {
    selector: "#oai_max_context_unlocked",
    oai_setting: "max_context_unlocked",
    type: "checkbox"
  },
  openai_max_context: {
    selector: "#openai_max_context",
    oai_setting: "openai_max_context",
    type: "input"
  },
  openai_max_tokens: {
    selector: "#openai_max_tokens",
    oai_setting: "openai_max_tokens",
    type: "input"
  },
  n: {
    selector: "#n_openai",
    oai_setting: "n",
    type: "input"
  },
  stream_openai: {
    selector: "#stream_toggle",
    oai_setting: "stream_openai",
    type: "checkbox"
  },
  temperature: {
    selector: "#temp_openai",
    oai_setting: "temp_openai",
    type: "input"
  },
  frequency_penalty: {
    selector: "#freq_pen_openai",
    oai_setting: "freq_pen_openai",
    type: "input"
  },
  presence_penalty: {
    selector: "#pres_pen_openai",
    oai_setting: "pres_pen_openai",
    type: "input"
  },
  top_p: {
    selector: "#top_p_openai",
    oai_setting: "top_p_openai",
    type: "input"
  },
  repetition_penalty: {
    selector: "#repetition_penalty_openai",
    oai_setting: "repetition_penalty_openai",
    type: "input"
  },
  min_p: {
    selector: "#min_p_openai",
    oai_setting: "min_p_openai",
    type: "input"
  },
  top_k: {
    selector: "#top_k_openai",
    oai_setting: "top_k_openai",
    type: "input"
  },
  top_a: {
    selector: "#top_a_openai",
    oai_setting: "top_a_openai",
    type: "input"
  },
  seed: {
    selector: "#seed_openai",
    oai_setting: "seed",
    type: "input"
  },
  squash_system_messages: {
    selector: "#squash_system_messages",
    oai_setting: "squash_system_messages",
    type: "checkbox"
  },
  reasoning_effort: {
    selector: "#openai_reasoning_effort",
    oai_setting: "reasoning_effort",
    type: "input"
  },
  show_thoughts: {
    selector: "#openai_show_thoughts",
    oai_setting: "show_thoughts",
    type: "checkbox"
  },
  request_images: {
    selector: "#openai_request_images",
    oai_setting: "request_images",
    type: "checkbox"
  },
  function_calling: {
    selector: "#openai_function_calling",
    oai_setting: "function_calling",
    type: "checkbox"
  },
  enable_web_search: {
    selector: "#openai_enable_web_search",
    oai_setting: "enable_web_search",
    type: "checkbox"
  },
  image_inlining: {
    selector: "#openai_image_inlining",
    oai_setting: "image_inlining",
    type: "checkbox"
  },
  inline_image_quality: {
    selector: "#openai_inline_image_quality",
    oai_setting: "inline_image_quality",
    type: "input"
  },
  video_inlining: {
    selector: "#openai_video_inlining",
    oai_setting: "video_inlining",
    type: "checkbox"
  },
  names_behavior: {
    selector: "#names_behavior",
    oai_setting: "names_behavior",
    type: "input"
  },
  wrap_in_quotes: {
    selector: "#wrap_in_quotes",
    oai_setting: "wrap_in_quotes",
    type: "checkbox"
  },
  prompts: {
    selector: "#prompts",
    oai_setting: "prompts",
    type: "none"
  },
  prompt_order: {
    selector: "#prompt_order",
    oai_setting: "prompt_order",
    type: "none"
  },
  extensions: {
    selector: "#extensions",
    oai_setting: "extensions",
    type: "none"
  }
};

// vendor/tavern-helper/src/function/preset.ts
function isPresetNormalPrompt(prompt) {
  return !isPresetSystemPrompt(prompt) && !isPresetPlaceholderPrompt(prompt);
}
function isPresetSystemPrompt(prompt) {
  return ["main", "nsfw", "jailbreak", "enhanceDefinitions"].includes(prompt.id);
}
function isPresetPlaceholderPrompt(prompt) {
  return [
    "worldInfoBefore",
    "personaDescription",
    "charDescription",
    "charPersonality",
    "scenario",
    "worldInfoAfter",
    "dialogueExamples",
    "chatHistory"
  ].includes(prompt.id);
}
var default_preset = {
  settings: {
    max_context: 2e6,
    max_completion_tokens: 300,
    reply_count: 1,
    should_stream: false,
    temperature: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    repetition_penalty: 1,
    top_p: 1,
    min_p: 0,
    top_k: 0,
    top_a: 0,
    seed: -1,
    squash_system_messages: false,
    reasoning_effort: "auto",
    request_thoughts: false,
    request_images: false,
    enable_function_calling: false,
    enable_web_search: false,
    allow_sending_images: "disabled",
    allow_sending_videos: false,
    character_name_prefix: "none",
    wrap_user_messages_in_quotes: false
  },
  prompts: [
    {
      id: "worldInfoBefore",
      name: "World Info (before) - \u89D2\u8272\u5B9A\u4E49\u4E4B\u524D",
      enabled: true,
      position: { type: "relative" },
      role: "system"
    },
    {
      id: "personaDescription",
      name: "Persona Description - \u73A9\u5BB6\u63CF\u8FF0",
      enabled: true,
      position: { type: "relative" },
      role: "system"
    },
    {
      id: "charDescription",
      name: "Char Description - \u89D2\u8272\u63CF\u8FF0",
      enabled: true,
      position: { type: "relative" },
      role: "system"
    },
    {
      id: "charPersonality",
      name: "Char Personality - \u89D2\u8272\u6027\u683C",
      enabled: true,
      position: { type: "relative" },
      role: "system"
    },
    { id: "scenario", name: "Scenario - \u60C5\u666F", enabled: true, position: { type: "relative" }, role: "system" },
    {
      id: "worldInfoAfter",
      name: "World Info (after) - \u89D2\u8272\u5B9A\u4E49\u4E4B\u540E",
      enabled: true,
      position: { type: "relative" },
      role: "system"
    },
    {
      id: "dialogueExamples",
      name: "Chat Examples - \u5BF9\u8BDD\u793A\u4F8B",
      enabled: true,
      position: { type: "relative" },
      role: "system"
    },
    {
      id: "chatHistory",
      name: "Chat History - \u804A\u5929\u8BB0\u5F55",
      enabled: true,
      position: { type: "relative" },
      role: "system"
    }
  ],
  prompts_unused: [],
  extensions: {
    tavern_helper: {
      scripts: [],
      variables: {}
    }
  }
};
var in_use_map = {
  temp_openai: "temperature",
  freq_pen_openai: "frequency_penalty",
  pres_pen_openai: "presence_penalty",
  top_p_openai: "top_p",
  repetition_penalty_openai: "repetition_penalty",
  min_p_openai: "min_p",
  top_k_openai: "top_k",
  top_a_openai: "top_a"
};
function toPresetPrompt(prompt, prompt_order) {
  const is_normal_prompt = prompt.system_prompt === false && (prompt.marker === void 0 || prompt.marker === false);
  const is_system_prompt = prompt.system_prompt === true && (prompt.marker === void 0 || prompt.marker === false);
  const is_placeholder_prompt = prompt.marker === true;
  let result = _({}).set("id", prompt.identifier ?? uuidv4()).set("name", prompt.name ?? "unnamed").set(
    "enabled",
    prompt_order.find((order) => order.identifier === prompt.identifier)?.enabled ?? prompt.enabled ?? true
  );
  if (is_normal_prompt || is_placeholder_prompt) {
    result = result.set("position.type", { 0: "relative", 1: "in_chat" }[prompt.injection_position ?? 0]);
    if (prompt.injection_position === 1) {
      result = result.set("position.depth", prompt.injection_depth ?? 4);
      result = result.set("position.order", prompt.injection_order ?? 100);
    }
  }
  result = result.set("role", prompt.role ?? "system");
  if (is_normal_prompt || is_system_prompt) {
    result = result.set("content", prompt.content ?? "");
  }
  if (prompt.extra) {
    result = result.set("extra", prompt.extra);
  }
  return result.value();
}
function fromPresetPrompt(prompt) {
  const is_normal_prompt = isPresetNormalPrompt(prompt);
  const is_system_prompt = isPresetSystemPrompt(prompt);
  const is_placeholder_prompt = isPresetPlaceholderPrompt(prompt);
  let result = _({}).set("identifier", prompt.id).set("name", prompt.name).set("enabled", prompt.enabled);
  if ((is_normal_prompt || is_placeholder_prompt) && !["dialogueExamples", "chatHistory"].includes(prompt.id)) {
    result = result.set("injection_position", (prompt.position?.type ?? "relative") === "relative" ? 0 : 1).set("injection_depth", prompt.position?.depth ?? 4).set("injection_order", prompt.position?.order ?? 100);
  }
  result = result.set("role", prompt.role);
  if (is_normal_prompt || is_system_prompt) {
    result = result.set("content", prompt.content);
  }
  result = result.set("system_prompt", is_system_prompt || is_placeholder_prompt).set("marker", is_placeholder_prompt);
  if (prompt.extra) {
    result = result.set("extra", prompt.extra);
  }
  result = result.set("forbid_overrides", false);
  return result.value();
}
function toPreset(preset, { in_use }) {
  const prompt_order = preset.prompt_order.find((order) => order.character_id === 100001)?.order ?? [];
  const prompts_all = preset.prompts.map((prompt) => toPresetPrompt(prompt, prompt_order));
  const prompt_order_identifiers = prompt_order.map((order) => order.identifier);
  const [prompts_used, prompts_unused] = _.partition(
    prompts_all,
    (prompt) => prompt_order_identifiers.includes(prompt.id)
  );
  const prompts = prompt_order_identifiers.map((identifier) => prompts_used.find((prompt) => prompt.id === identifier));
  const extensions = klona(preset.extensions);
  _.set(extensions, "regex_scripts", (extensions?.regex_scripts ?? []).map(to_tavern_regex));
  return {
    settings: {
      max_context: Number(preset.openai_max_context),
      max_completion_tokens: Number(preset.openai_max_tokens),
      reply_count: Number(preset.n),
      should_stream: Boolean(preset.stream_openai),
      temperature: Number(in_use ? preset.temp_openai : preset.temperature),
      frequency_penalty: Number(in_use ? preset.freq_pen_openai : preset.frequency_penalty),
      presence_penalty: Number(in_use ? preset.pres_pen_openai : preset.presence_penalty),
      top_p: Number(in_use ? preset.top_p_openai : preset.top_p),
      repetition_penalty: Number(in_use ? preset.repetition_penalty_openai : preset.repetition_penalty),
      min_p: Number(in_use ? preset.min_p_openai : preset.min_p),
      top_k: Number(in_use ? preset.top_k_openai : preset.top_k),
      top_a: Number(in_use ? preset.top_a_openai : preset.top_a),
      seed: Number(preset.seed),
      squash_system_messages: Boolean(preset.squash_system_messages),
      reasoning_effort: String(preset.reasoning_effort),
      request_thoughts: Boolean(preset.show_thoughts),
      request_images: Boolean(preset.request_images),
      enable_function_calling: Boolean(preset.function_calling),
      enable_web_search: Boolean(preset.enable_web_search),
      allow_sending_images: Boolean(preset.image_inlining) === false ? "disabled" : String(preset.inline_image_quality),
      allow_sending_videos: Boolean(preset.video_inlining),
      character_name_prefix: {
        [-1]: "none",
        [0]: "default",
        [2]: "content",
        [1]: "completion"
      }[Number(preset.names_behavior)],
      wrap_user_messages_in_quotes: Boolean(preset.wrap_in_quotes)
    },
    prompts,
    prompts_unused,
    // @ts-expect-error 类型是正确的, extensions 里必然有 tavern_helper
    extensions
  };
}
function fromPreset(preset) {
  const id_set = /* @__PURE__ */ new Set();
  const handle_id_collision = (id, is_normal_prompt) => {
    if (!id_set.has(id)) {
      id_set.add(id);
      return id;
    }
    if (!is_normal_prompt) {
      throw Error(`\u4FEE\u6539\u7684\u9884\u8BBE\u4E2D\u5B58\u5728\u91CD\u590D\u7684\u7CFB\u7EDF/\u5360\u4F4D\u63D0\u793A\u8BCD '${id}'`);
    }
    const new_id = uuidv4();
    id_set.add(new_id);
    return new_id;
  };
  const make_uncollision_prompts = (prompts) => {
    return prompts.map((prompt) => {
      const new_id = handle_id_collision(prompt.id, isPresetNormalPrompt(prompt));
      return {
        ...prompt,
        id: new_id
      };
    });
  };
  preset.prompts = make_uncollision_prompts(preset.prompts);
  preset.prompts_unused = make_uncollision_prompts(preset.prompts_unused);
  const prompt_used = preset.prompts.map((prompt) => fromPresetPrompt(prompt));
  const prompt_unused = preset.prompts_unused.map((prompt) => fromPresetPrompt(prompt));
  const extensions = klona(preset.extensions);
  if (_.has(extensions, "regex_scripts[0].source")) {
    extensions.regex_scripts = extensions.regex_scripts.map(from_tavern_regex);
  }
  return {
    max_context_unlocked: true,
    openai_max_context: preset.settings.max_context,
    openai_max_tokens: preset.settings.max_completion_tokens,
    n: preset.settings.reply_count,
    stream_openai: preset.settings.should_stream,
    // vv in use vv
    temp_openai: preset.settings.temperature,
    freq_pen_openai: preset.settings.frequency_penalty,
    pres_pen_openai: preset.settings.presence_penalty,
    top_p_openai: preset.settings.top_p,
    repetition_penalty_openai: preset.settings.repetition_penalty,
    min_p_openai: preset.settings.min_p,
    top_k_openai: preset.settings.top_k,
    top_a_openai: preset.settings.top_a,
    // vv in file vv
    temperature: preset.settings.temperature,
    frequency_penalty: preset.settings.frequency_penalty,
    presence_penalty: preset.settings.presence_penalty,
    top_p: preset.settings.top_p,
    repetition_penalty: preset.settings.repetition_penalty,
    min_p: preset.settings.min_p,
    top_k: preset.settings.top_k,
    top_a: preset.settings.top_a,
    seed: preset.settings.seed,
    squash_system_messages: preset.settings.squash_system_messages,
    reasoning_effort: preset.settings.reasoning_effort,
    show_thoughts: preset.settings.request_thoughts,
    request_images: preset.settings.request_images,
    function_calling: preset.settings.enable_function_calling,
    enable_web_search: preset.settings.enable_web_search,
    image_inlining: preset.settings.allow_sending_images !== "disabled",
    inline_image_quality: preset.settings.allow_sending_images === "disabled" ? "auto" : preset.settings.allow_sending_images,
    video_inlining: preset.settings.allow_sending_videos,
    names_behavior: {
      none: -1,
      default: 0,
      content: 2,
      completion: 1
    }[preset.settings.character_name_prefix],
    wrap_in_quotes: preset.settings.wrap_user_messages_in_quotes,
    prompts: [...prompt_used, ...prompt_unused],
    prompt_order: [
      {
        character_id: 100001,
        order: prompt_used.map((prompt) => ({ identifier: prompt.identifier, enabled: prompt.enabled ?? true }))
      }
    ],
    extensions
  };
}
function getPresetNames() {
  return klona(["in_use", ...preset_manager.getAllPresets()]);
}
function getLoadedPresetName() {
  return preset_manager.getSelectedPresetName();
}
function loadPreset(preset_name) {
  const preset_value = preset_manager.findPreset(preset_name);
  if (!preset_value) {
    return false;
  }
  preset_manager.selectPreset(preset_value);
  return true;
}
function getPreset(preset_name) {
  const original_preset = preset_name === "in_use" ? oai_settings : getCompletionPresetByName(preset_name);
  if (!original_preset) {
    throw Error(`\u9884\u8BBE '${preset_name}' \u4E0D\u5B58\u5728`);
  }
  return klona(toPreset(original_preset, { in_use: preset_name === "in_use" }));
}
async function createPreset(preset_name, preset = default_preset) {
  if (getPresetNames().includes(preset_name)) {
    return false;
  }
  await createOrReplacePreset(preset_name, preset);
  return true;
}
function updateOriginalPresetData(data, updates, { in_use, render }) {
  let lodash_data = _(data);
  Object.entries(settingsToUpdate).forEach(([key, { oai_setting }]) => {
    lodash_data = lodash_data.set(
      in_use ? oai_setting : _.get(in_use_map, oai_setting, oai_setting),
      updates[key]
    );
  });
  lodash_data.value();
  if (!in_use) {
    return;
  }
  saveSettingsDebounced();
  if (render === "none") {
    return;
  }
  const checkboxes = $();
  const inputs = $();
  Object.entries(settingsToUpdate).forEach(([key, { selector, type }]) => {
    switch (type) {
      case "checkbox":
        $(selector).prop("checked", updates[key]);
        checkboxes.add(selector);
        break;
      case "input":
        $(selector).val(updates[key]);
        inputs.add(selector);
        break;
    }
  });
  $(checkboxes).trigger("input", { source: "preset" });
  $(inputs).trigger("input", { source: "preset" });
  if (render === "debounced") {
    promptManager.renderDebounced();
  } else {
    promptManager.render(false);
  }
}
async function createOrReplacePreset(preset_name, preset = default_preset, { render = "debounced" } = {}) {
  const original_preset = fromPreset(preset);
  const is_existing = getPresetNames().includes(preset_name);
  if (!is_existing) {
    const { presets, preset_names } = preset_manager.getPresetList();
    presets.push(original_preset);
    preset_names[preset_name] = presets.length - 1;
    preset_manager.select.append(
      $("<option></option>", { value: presets.length - 1, text: preset_name, selected: false })
    );
  } else {
    updateOriginalPresetData(
      preset_name === "in_use" ? oai_settings : getCompletionPresetByName(preset_name),
      original_preset,
      {
        in_use: preset_name === "in_use",
        render
      }
    );
  }
  if (preset_name !== "in_use") {
    await preset_manager.savePreset(preset_name, getCompletionPresetByName(preset_name), {
      skipUpdate: true
    });
  }
  return !is_existing;
}
async function deletePreset(preset_name) {
  return Boolean(await preset_manager.deletePreset(preset_name));
}
async function renamePreset(preset_name, new_name) {
  if (!getPresetNames().includes(preset_name)) {
    return false;
  }
  await createPreset(new_name, getPreset(preset_name));
  await deletePreset(preset_name);
  return true;
}
async function replacePreset(preset_name, preset, options = {}) {
  if (!getPresetNames().includes(preset_name)) {
    throw Error(`\u9884\u8BBE '${preset_name}' \u4E0D\u5B58\u5728`);
  }
  await createOrReplacePreset(preset_name, preset, options);
}
async function updatePresetWith(preset_name, updater, options = {}) {
  if (!getPresetNames().includes(preset_name)) {
    throw Error(`\u9884\u8BBE '${preset_name}' \u4E0D\u5B58\u5728`);
  }
  const preset = await updater(getPreset(preset_name));
  await replacePreset(preset_name, preset, options);
  return preset;
}
async function setPreset(preset_name, preset, options = {}) {
  return await updatePresetWith(
    preset_name,
    (old_preset) => {
      return {
        settings: _.defaultsDeep(preset.settings, old_preset.settings),
        prompts: preset.prompts ?? old_preset.prompts,
        prompts_unused: preset.prompts_unused ?? old_preset.prompts_unused,
        extensions: _.defaultsDeep(preset.extensions, old_preset.extensions)
      };
    },
    options
  );
}

// vendor/tavern-helper/src/function/event.ts
var event_exports = {};
__export(event_exports, {
  _eventClearAll: () => _eventClearAll,
  _eventClearEvent: () => _eventClearEvent,
  _eventClearListener: () => _eventClearListener,
  _eventEmit: () => _eventEmit,
  _eventEmitAndWait: () => _eventEmitAndWait,
  _eventMakeFirst: () => _eventMakeFirst,
  _eventMakeLast: () => _eventMakeLast,
  _eventOn: () => _eventOn,
  _eventOnButton: () => _eventOnButton,
  _eventOnce: () => _eventOnce,
  _eventRemoveListener: () => _eventRemoveListener,
  iframe_events: () => iframe_events,
  tavern_events: () => tavern_events
});

// vendor/tavern-helper/src/function/util.ts
var util_exports2 = {};
__export(util_exports2, {
  _errorCatched: () => _errorCatched,
  _getCurrentMessageId: () => _getCurrentMessageId,
  _getIframeName: () => _getIframeName,
  _getScriptId: () => _getScriptId,
  _reloadIframe: () => _reloadIframe,
  errorCatched: () => errorCatched,
  getLastMessageId: () => getLastMessageId,
  getMessageId: () => getMessageId,
  substitudeMacros: () => substitudeMacros
});

// node_modules/is-promise/index.mjs
function isPromise(obj) {
  return !!obj && (typeof obj === "object" || typeof obj === "function") && typeof obj.then === "function";
}

// node_modules/zod/v4/core/util.js
function jsonStringifyReplacer(_2, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {
};
function members(proto, table) {
  for (const key in table) {
    const desc = Object.getOwnPropertyDescriptor(table, key);
    if (desc.get)
      Object.defineProperty(proto, key, { ...desc, enumerable: false });
    else
      defineBound(proto, key, desc.value);
  }
  for (const sym of Object.getOwnPropertySymbols(table)) {
    defineBound(proto, sym, table[sym]);
  }
}
function own(inst, key, value, enumerable = true) {
  Object.defineProperty(inst, key, { configurable: true, writable: true, enumerable, value });
  return value;
}
function defineBound(proto, key, fn) {
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      return this == null ? fn : own(this, key, fn.bind(this));
    },
    set(value) {
      own(this, key, value);
    }
  });
}

// node_modules/zod/v4/core/core.js
var _a;
var _zodDesc = { value: void 0, enumerable: false };
var _E = "captureStackTrace" in Error ? Error : null;
function newError(Definition) {
  const E = _E;
  if (E) {
    const saved = E.stackTraceLimit;
    if (typeof saved === "number") {
      try {
        E.stackTraceLimit = 0;
      } catch {
        _E = null;
        return new Definition();
      }
      try {
        return new Definition();
      } finally {
        E.stackTraceLimit = saved;
      }
    }
  }
  return new Definition();
}
// @__NO_SIDE_EFFECTS__
function $constructor(name, initializer3, proto, params) {
  const zodProto = {};
  function Internals(def) {
    this.def = def;
    this.constr = _2;
    this.traits = /* @__PURE__ */ new Set();
  }
  Internals.prototype = zodProto;
  const protoMembers = proto;
  const initialized = protoMembers && /* @__PURE__ */ new WeakSet();
  function init(inst, def) {
    if (!inst._zod) {
      _zodDesc.value = new Internals(def);
      try {
        Object.defineProperty(inst, "_zod", _zodDesc);
      } finally {
        _zodDesc.value = void 0;
      }
    }
    if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer3(inst, def);
    if (initialized) {
      const own2 = Object.getPrototypeOf(inst);
      const ctorProto = inst._zod.constr.prototype;
      let up = own2;
      while (up && up !== ctorProto)
        up = Object.getPrototypeOf(up);
      const target = up ?? own2;
      if (!initialized.has(target)) {
        initialized.add(target);
        members(target, protoMembers);
      }
    }
    const proto2 = _2.prototype;
    for (const k in proto2) {
      if (!Object.prototype.hasOwnProperty.call(proto2, k))
        continue;
      if (!(k in inst)) {
        inst[k] = proto2[k].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;
  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _2(def) {
    const inst = params?.Parent ? newError(Definition) : this;
    init(inst, def);
    const deferred = inst._zod.deferred;
    if (deferred) {
      for (const fn of deferred) {
        fn();
      }
      inst._zod.deferred = void 0;
    }
    const pp = globalThis.__zod_globalConfig?.postProcessor;
    if (pp)
      pp(inst);
    return inst;
  }
  Object.defineProperty(_2, "init", { value: init });
  Object.defineProperty(_2, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_2, "name", { value: name });
  return _2;
}
(_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;

// node_modules/zod/v4/core/errors.js
function _getMessage() {
  const internals = this._zod;
  internals.message ?? (internals.message = JSON.stringify(internals.def, jsonStringifyReplacer, 2));
  return internals.message;
}
function _setMessage(value) {
  this._zod.message = value;
}
var _messageDesc = {
  get: _getMessage,
  set: _setMessage,
  enumerable: true,
  configurable: true
};
var _issuesDesc = { value: void 0, enumerable: false };
var _installedToString = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  _issuesDesc.value = def;
  Object.defineProperty(inst, "issues", _issuesDesc);
  _issuesDesc.value = void 0;
  Object.defineProperty(inst, "message", _messageDesc);
  const proto = Object.getPrototypeOf(inst);
  if (!_installedToString.has(proto)) {
    _installedToString.add(proto);
    Object.defineProperty(proto, "toString", {
      configurable: true,
      enumerable: false,
      get() {
        const value = () => this.message;
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
        return value;
      },
      set(value) {
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
      }
    });
  }
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, void 0, {
  Parent: Error
});
function node(obj, key, make) {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    if (key === "__proto__") {
      Object.defineProperty(obj, key, { value: make(), writable: true, enumerable: true, configurable: true });
    } else {
      obj[key] = make();
    }
  }
  return obj[key];
}
function flattenError(error, mapper = (issue) => issue.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error.issues) {
    if (sub.path.length > 0) {
      node(fieldErrors, sub.path[0], () => []).push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error, mapper = (issue) => issue.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error2, path = []) => {
    for (const issue of error2.issues) {
      if (issue.code === "invalid_union" && issue.errors.length) {
        issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
      } else if (issue.code === "invalid_key") {
        processError({ issues: issue.issues }, [...path, ...issue.path]);
      } else if (issue.code === "invalid_element") {
        processError({ issues: issue.issues }, [...path, ...issue.path]);
      } else {
        const fullpath = [...path, ...issue.path];
        if (fullpath.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i2 = 0;
          while (i2 < fullpath.length) {
            const el = fullpath[i2];
            const terminal = i2 === fullpath.length - 1;
            if (el === "_errors") {
              if (terminal)
                curr._errors.push(mapper(issue));
              i2++;
              continue;
            }
            if (!Object.prototype.hasOwnProperty.call(curr, el)) {
              Object.defineProperty(curr, el, {
                value: { _errors: [] },
                enumerable: true,
                writable: true,
                configurable: true
              });
            }
            const node2 = curr[el];
            if (terminal) {
              node2._errors.push(mapper(issue));
            }
            curr = node2;
            i2++;
          }
        }
      }
    }
  };
  processError(error);
  return fieldErrors;
}

// node_modules/zod/v4/classic/errors.js
var _installedErrorProtos = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
function _lazyMethod(proto, key, make) {
  Object.defineProperty(proto, key, {
    configurable: true,
    enumerable: false,
    get() {
      const value = make(this);
      Object.defineProperty(this, key, { value, configurable: true, writable: true });
      return value;
    },
    set(value) {
      Object.defineProperty(this, key, { value, configurable: true, writable: true });
    }
  });
}
var initializer2 = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  const proto = Object.getPrototypeOf(inst);
  if (_installedErrorProtos.has(proto))
    return;
  _installedErrorProtos.add(proto);
  _lazyMethod(proto, "format", (self) => (mapper) => formatError(self, mapper));
  _lazyMethod(proto, "flatten", (self) => (mapper) => flattenError(self, mapper));
  _lazyMethod(proto, "addIssue", (self) => (issue) => {
    self.issues.push(issue);
    self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
  });
  _lazyMethod(proto, "addIssues", (self) => (issues2) => {
    self.issues.push(...issues2);
    self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
  });
  Object.defineProperty(proto, "isEmpty", {
    configurable: true,
    enumerable: false,
    get() {
      return this.issues.length === 0;
    }
  });
};
var ZodError = /* @__PURE__ */ $constructor("ZodError", initializer2);

// vendor/tavern-helper/src/function/util.ts
function _reloadIframe() {
  this.location.reload();
}
function substitudeMacros(text) {
  return substituteParamsExtended(text);
}
function getLastMessageId() {
  return Number(substitudeMacros("{{lastMessageId}}"));
}
function errorCatched(fn) {
  const onError = (error) => {
    toastr.error(
      `<pre style="white-space: pre-wrap">${error.stack ? error instanceof ZodError ? [error.message, error.stack].join("\n") : error.stack : error.message}</pre>`,
      error.name,
      {
        escapeHtml: false,
        toastClass: "toastr w-fit! min-w-[300px]"
      }
    );
    throw error;
  };
  return (...args) => {
    try {
      const result = fn(...args);
      if (isPromise(result)) {
        return result.then(void 0, (error) => {
          onError(error);
        });
      }
      return result;
    } catch (error) {
      return onError(error);
    }
  };
}
function _errorCatched(fn) {
  const onError = (error) => {
    const iframe_name = _getIframeName.call(this);
    const message = error.stack ? error instanceof ZodError ? [error.message, error.stack].join("\n") : error.stack : error.message;
    toastr.error(`<pre style="white-space: pre-wrap">${message}</pre>`, `[${iframe_name}] ${error.name}`, {
      escapeHtml: false,
      toastClass: "toastr w-fit! min-w-[300px]"
    });
    this._th_impl._log(iframe_name, "error", message);
    throw error;
  };
  return (...args) => {
    try {
      const result = fn(...args);
      if (isPromise(result)) {
        return result.then(void 0, (error) => {
          onError(error);
        });
      }
      return result;
    } catch (error) {
      return onError(error);
    }
  };
}
function _getIframeName() {
  const frameElement = this.frameElement;
  const cachedId = this.__TH_IFRAME_ID || this.name;
  if (frameElement?.id) {
    this.__TH_IFRAME_ID = frameElement.id;
    if (!this.name) {
      this.name = frameElement.id;
    }
    return frameElement.id;
  }
  if (cachedId) {
    if (!this.name) {
      this.name = cachedId;
    }
    return cachedId;
  }
  throw new TypeError("frameElement is null while resolving iframe id");
}
function _getScriptId() {
  const iframe_name = _getIframeName.call(this);
  if (!iframe_name.startsWith("TH-script--")) {
    throw new Error("\u4F60\u53EA\u80FD\u5728\u811A\u672C iframe \u5185\u83B7\u53D6 getScriptId!");
  }
  return iframe_name.replace(/TH-script--.+--/, "");
}
function _getCurrentMessageId() {
  return getMessageId(_getIframeName.call(this));
}
function getMessageId(iframe_name) {
  const match = iframe_name.match(/^TH-message--(\d+)--\d+(_\d+)?$/);
  if (!match) {
    throw Error(`\u83B7\u53D6 ${iframe_name} \u6240\u5728\u697C\u5C42 id \u65F6\u51FA\u9519: \u4E0D\u8981\u5BF9\u5168\u5C40\u811A\u672C iframe \u8C03\u7528 getMessageId!`);
  }
  return parseInt(match[1].toString());
}

// vendor/tavern-helper/src/util/algorithm.ts
function getOrSet(map, key, defaulter) {
  const existing_value = map.get(key);
  if (existing_value) {
    return existing_value;
  }
  const default_value = defaulter();
  map.set(key, default_value);
  return default_value;
}

// vendor/tavern-helper/src/function/event.ts
var iframe_event_listener_wrapper_map = /* @__PURE__ */ new Map();
function get_event_listener_wrapper_map() {
  return getOrSet(
    iframe_event_listener_wrapper_map,
    _getIframeName.call(this),
    () => /* @__PURE__ */ new Map()
  );
}
function get_listener_wrapper_map(event_type) {
  const event_listener_wrapper_map = get_event_listener_wrapper_map.call(this);
  return getOrSet(event_listener_wrapper_map, event_type, () => /* @__PURE__ */ new Map());
}
function register_listener_wrapper(event_type, listener, options = {}) {
  const listener_wrapper_map = get_listener_wrapper_map.call(this, event_type);
  return getOrSet(listener_wrapper_map, listener, () => {
    const wrapper = (...args) => {
      const listener_wrapper_map2 = get_listener_wrapper_map.call(this, event_type);
      if (!listener_wrapper_map2?.has(listener)) {
        eventSource.removeListener(event_type, wrapper);
        return;
      }
      if ([
        tavern_events.MESSAGE_SWIPED,
        tavern_events.MESSAGE_SENT,
        tavern_events.MESSAGE_RECEIVED,
        tavern_events.MESSAGE_EDITED,
        tavern_events.MESSAGE_UPDATED,
        tavern_events.USER_MESSAGE_RENDERED,
        tavern_events.CHARACTER_MESSAGE_RENDERED
      ].some((event) => event === event_type)) {
        args[0] = parseInt(args[0]);
        if (isNaN(args[0])) {
          return;
        }
      }
      const result = listener(...args);
      if (options.once) {
        _eventRemoveListener.call(this, event_type, listener);
      }
      return result;
    };
    return wrapper;
  });
}
function make_event_on_return(event_type, listener) {
  return {
    stop: () => _eventRemoveListener.call(this, event_type, listener)
  };
}
function _eventOn(event_type, listener) {
  const wrapped = register_listener_wrapper.call(this, event_type, listener);
  eventSource.on(event_type, wrapped);
  return make_event_on_return.call(this, event_type, wrapped);
}
function _eventOnButton(event_type, listener) {
  _eventOn.call(this, _getButtonEvent.call(this, event_type), listener);
}
function _eventMakeLast(event_type, listener) {
  const wrapped = register_listener_wrapper.call(this, event_type, listener);
  eventSource.makeLast(event_type, wrapped);
  return make_event_on_return.call(this, event_type, wrapped);
}
function _eventMakeFirst(event_type, listener) {
  const wrapped = register_listener_wrapper.call(this, event_type, listener);
  eventSource.makeFirst(event_type, wrapped);
  return make_event_on_return.call(this, event_type, wrapped);
}
function _eventOnce(event_type, listener) {
  const wrapped = register_listener_wrapper.call(this, event_type, listener, { once: true });
  eventSource.once(event_type, wrapped);
  return make_event_on_return.call(this, event_type, wrapped);
}
async function _eventEmit(event_type, ...data) {
  await eventSource.emit(event_type, ...data);
}
function _eventEmitAndWait(event_type, ...data) {
  eventSource.emitAndWait(event_type, ...data);
}
function _eventRemoveListener(event_type, listener) {
  const listener_wrapper_map = get_listener_wrapper_map.call(this, event_type);
  if (listener_wrapper_map) {
    const wrapper = listener_wrapper_map.get(listener);
    if (wrapper) {
      listener_wrapper_map.delete(listener);
      eventSource.removeListener(event_type, wrapper);
    }
  }
}
function _eventClearEvent(event_type) {
  get_listener_wrapper_map.call(this, event_type)?.forEach((_wrapper, listener) => {
    _eventRemoveListener.call(this, event_type, listener);
  });
}
function _eventClearListener(listener) {
  get_event_listener_wrapper_map.call(this).forEach((_listeners, event_type) => {
    _eventRemoveListener.call(this, event_type, listener);
  });
}
function _eventClearAll() {
  get_event_listener_wrapper_map.call(this).forEach((listeners, event_type) => {
    listeners.forEach((_wrapper, listener) => {
      _eventRemoveListener.call(this, event_type, listener);
    });
  });
  iframe_event_listener_wrapper_map.delete(_getIframeName.call(this));
}
var iframe_events = {
  MESSAGE_IFRAME_RENDER_STARTED: "message_iframe_render_started",
  MESSAGE_IFRAME_RENDER_ENDED: "message_iframe_render_ended",
  GENERATION_STARTED: "js_generation_started",
  STREAM_TOKEN_RECEIVED_FULLY: "js_stream_token_received_fully",
  STREAM_TOKEN_RECEIVED_INCREMENTALLY: "js_stream_token_received_incrementally",
  GENERATION_ENDED: "js_generation_ended"
};
var tavern_events = {
  APP_READY: "app_ready",
  EXTRAS_CONNECTED: "extras_connected",
  MESSAGE_SWIPED: "message_swiped",
  MESSAGE_SENT: "message_sent",
  MESSAGE_RECEIVED: "message_received",
  MESSAGE_EDITED: "message_edited",
  MESSAGE_DELETED: "message_deleted",
  MESSAGE_UPDATED: "message_updated",
  MESSAGE_FILE_EMBEDDED: "message_file_embedded",
  MESSAGE_REASONING_EDITED: "message_reasoning_edited",
  MESSAGE_REASONING_DELETED: "message_reasoning_deleted",
  MESSAGE_SWIPE_DELETED: "message_swipe_deleted",
  MORE_MESSAGES_LOADED: "more_messages_loaded",
  IMPERSONATE_READY: "impersonate_ready",
  CHAT_CHANGED: "chat_id_changed",
  GENERATION_AFTER_COMMANDS: "GENERATION_AFTER_COMMANDS",
  GENERATION_STARTED: "generation_started",
  GENERATION_STOPPED: "generation_stopped",
  GENERATION_ENDED: "generation_ended",
  SD_PROMPT_PROCESSING: "sd_prompt_processing",
  EXTENSIONS_FIRST_LOAD: "extensions_first_load",
  EXTENSION_SETTINGS_LOADED: "extension_settings_loaded",
  SETTINGS_LOADED: "settings_loaded",
  SETTINGS_UPDATED: "settings_updated",
  MOVABLE_PANELS_RESET: "movable_panels_reset",
  SETTINGS_LOADED_BEFORE: "settings_loaded_before",
  SETTINGS_LOADED_AFTER: "settings_loaded_after",
  CHATCOMPLETION_SOURCE_CHANGED: "chatcompletion_source_changed",
  CHATCOMPLETION_MODEL_CHANGED: "chatcompletion_model_changed",
  OAI_PRESET_CHANGED_BEFORE: "oai_preset_changed_before",
  OAI_PRESET_CHANGED_AFTER: "oai_preset_changed_after",
  OAI_PRESET_EXPORT_READY: "oai_preset_export_ready",
  OAI_PRESET_IMPORT_READY: "oai_preset_import_ready",
  WORLDINFO_SETTINGS_UPDATED: "worldinfo_settings_updated",
  WORLDINFO_UPDATED: "worldinfo_updated",
  CHARACTER_EDITOR_OPENED: "character_editor_opened",
  CHARACTER_EDITED: "character_edited",
  CHARACTER_PAGE_LOADED: "character_page_loaded",
  USER_MESSAGE_RENDERED: "user_message_rendered",
  CHARACTER_MESSAGE_RENDERED: "character_message_rendered",
  FORCE_SET_BACKGROUND: "force_set_background",
  CHAT_DELETED: "chat_deleted",
  CHAT_CREATED: "chat_created",
  GENERATE_BEFORE_COMBINE_PROMPTS: "generate_before_combine_prompts",
  GENERATE_AFTER_COMBINE_PROMPTS: "generate_after_combine_prompts",
  GENERATE_AFTER_DATA: "generate_after_data",
  WORLD_INFO_ACTIVATED: "world_info_activated",
  TEXT_COMPLETION_SETTINGS_READY: "text_completion_settings_ready",
  CHAT_COMPLETION_SETTINGS_READY: "chat_completion_settings_ready",
  CHAT_COMPLETION_PROMPT_READY: "chat_completion_prompt_ready",
  CHARACTER_FIRST_MESSAGE_SELECTED: "character_first_message_selected",
  CHARACTER_DELETED: "characterDeleted",
  CHARACTER_DUPLICATED: "character_duplicated",
  CHARACTER_RENAMED: "character_renamed",
  CHARACTER_RENAMED_IN_PAST_CHAT: "character_renamed_in_past_chat",
  SMOOTH_STREAM_TOKEN_RECEIVED: "stream_token_received",
  STREAM_TOKEN_RECEIVED: "stream_token_received",
  STREAM_REASONING_DONE: "stream_reasoning_done",
  FILE_ATTACHMENT_DELETED: "file_attachment_deleted",
  WORLDINFO_FORCE_ACTIVATE: "worldinfo_force_activate",
  OPEN_CHARACTER_LIBRARY: "open_character_library",
  ONLINE_STATUS_CHANGED: "online_status_changed",
  IMAGE_SWIPED: "image_swiped",
  CONNECTION_PROFILE_LOADED: "connection_profile_loaded",
  CONNECTION_PROFILE_CREATED: "connection_profile_created",
  CONNECTION_PROFILE_DELETED: "connection_profile_deleted",
  CONNECTION_PROFILE_UPDATED: "connection_profile_updated",
  TOOL_CALLS_PERFORMED: "tool_calls_performed",
  TOOL_CALLS_RENDERED: "tool_calls_rendered",
  CHARACTER_MANAGEMENT_DROPDOWN: "charManagementDropdown",
  SECRET_WRITTEN: "secret_written",
  SECRET_DELETED: "secret_deleted",
  SECRET_ROTATED: "secret_rotated",
  SECRET_EDITED: "secret_edited",
  PRESET_CHANGED: "preset_changed",
  PRESET_DELETED: "preset_deleted",
  PRESET_RENAMED: "preset_renamed",
  PRESET_RENAMED_BEFORE: "preset_renamed_before",
  MAIN_API_CHANGED: "main_api_changed",
  WORLDINFO_ENTRIES_LOADED: "worldinfo_entries_loaded",
  WORLDINFO_SCAN_DONE: "worldinfo_scan_done",
  MEDIA_ATTACHMENT_DELETED: "media_attachment_deleted"
};

// vendor/tavern-helper/src/function/global.ts
var global_exports = {};
__export(global_exports, {
  _initializeGlobal: () => _initializeGlobal,
  _waitGlobalInitialized: () => _waitGlobalInitialized,
  initializeGlobal: () => initializeGlobal,
  waitGlobalInitialized: () => waitGlobalInitialized
});

// node_modules/async-wait-until/dist/index.esm.js
function e(e2, t2, o, n) {
  return new (o || (o = Promise))((function(r2, i2) {
    function u(e3) {
      try {
        s(n.next(e3));
      } catch (e4) {
        i2(e4);
      }
    }
    function c(e3) {
      try {
        s(n.throw(e3));
      } catch (e4) {
        i2(e4);
      }
    }
    function s(e3) {
      var t3;
      e3.done ? r2(e3.value) : (t3 = e3.value, t3 instanceof o ? t3 : new o((function(e4) {
        e4(t3);
      }))).then(u, c);
    }
    s((n = n.apply(e2, t2 || [])).next());
  }));
}
var t = class _t extends Error {
  constructor(e2) {
    super(null != e2 ? `Timed out after waiting for ${e2} ms` : "Timed out"), Object.setPrototypeOf(this, _t.prototype);
  }
};
var r = Number.POSITIVE_INFINITY;
var i = (o, n, i2) => {
  var u, c;
  const s = null !== (u = "number" == typeof n ? n : null == n ? void 0 : n.timeout) && void 0 !== u ? u : 5e3, l = null !== (c = "number" == typeof n ? i2 : null == n ? void 0 : n.intervalBetweenAttempts) && void 0 !== c ? c : 50;
  let a, f;
  return Promise.race([...s !== r ? [new Promise(((e2, o2) => {
    a = setTimeout((() => {
      o2(new t(s));
    }), s);
  }))] : [], new Promise(((t2, n2) => {
    const r2 = () => e(void 0, void 0, void 0, (function* () {
      try {
        const e2 = yield o();
        if (e2) return void t2(e2);
        f = setTimeout(r2, l);
      } catch (e2) {
        n2(e2);
      }
    }));
    r2();
  }))]).finally((() => {
    a && clearTimeout(a), f && clearTimeout(f);
  }));
};

// vendor/tavern-helper/src/function/global.ts
function hasMvuData(chat_message) {
  return _.has(chat_message?.variables?.[chat_message.swipe_id ?? 0], "stat_data");
}
async function waitMvu() {
  try {
    await i(() => hasMvuData(chat[0]) || _.takeRight(chat, 10).some(hasMvuData));
  } catch (error) {
  }
}
function initializeGlobal(global, value) {
  _.set(window, global, value);
  eventSource.emit(`global_${global}_initialized`);
}
function _initializeGlobal(global, value) {
  _.set(window, global, value);
  _eventEmit.call(this, `global_${global}_initialized`);
}
async function waitGlobalInitialized(global) {
  if (_.has(window, global)) {
    return;
  }
  return new Promise((resolve) => {
    eventSource.once(`global_${global}_initialized`, () => {
      resolve();
    });
  });
}
async function _waitGlobalInitialized(global) {
  if (_.has(window, global)) {
    Object.defineProperty(this, global, {
      get: () => _.get(window, global),
      configurable: true
    });
    if (global === "Mvu") {
      await waitMvu();
    }
    return;
  }
  return new Promise((resolve) => {
    _eventOnce.call(this, `global_${global}_initialized`, async () => {
      Object.defineProperty(this, global, {
        get: () => _.get(window, global),
        configurable: true
      });
      if (global === "Mvu") {
        await waitMvu();
      }
      resolve();
    });
  });
}

// vendor/tavern-helper/src/function/version.ts
var version_exports = {};
__export(version_exports, {
  getTavernHelperVersion: () => getTavernHelperVersion,
  getTavernVersion: () => getTavernVersion,
  updateTavernHelper: () => updateTavernHelper
});

// vendor/tavern-helper/manifest.json
var manifest_default = {
  display_name: "\u9152\u9986\u52A9\u624B",
  loading_order: 100,
  requires: [],
  optional: [],
  js: "dist/index.js",
  css: "dist/index.css",
  hooks: {
    activate: "activateTauriTavernChatSurface"
  },
  author: "KAKAA",
  version: "4.9.5",
  homePage: "https://github.com/N0VI028/JS-Slash-Runner",
  auto_update: true,
  minimum_client_version: "1.12.13",
  i18n: {
    en: "i18n/en.json"
  }
};

// vendor/tavern-helper/src/function/version.ts
function getTavernHelperVersion() {
  return manifest_default.version;
}
async function updateTavernHelper() {
  return updateExtension(getTavernHelperExtensionId()).then((res) => res.ok);
}
function getTavernVersion() {
  return version;
}

// vendor/tavern-helper/src/function/lorebook_entry.ts
var lorebook_entry_exports = {};
__export(lorebook_entry_exports, {
  createLorebookEntries: () => createLorebookEntries,
  createLorebookEntry: () => createLorebookEntry,
  deleteLorebookEntries: () => deleteLorebookEntries,
  deleteLorebookEntry: () => deleteLorebookEntry,
  getLorebookEntries: () => getLorebookEntries,
  replaceLorebookEntries: () => replaceLorebookEntries,
  setLorebookEntries: () => setLorebookEntries,
  updateLorebookEntriesWith: () => updateLorebookEntriesWith
});
var default_original_lorebook_entry = {
  key: [],
  keysecondary: [],
  comment: "",
  content: "",
  constant: false,
  vectorized: false,
  selective: true,
  selectiveLogic: 0,
  addMemo: true,
  order: 100,
  position: 0,
  disable: false,
  excludeRecursion: false,
  preventRecursion: false,
  matchPersonaDescription: false,
  matchCharacterDescription: false,
  matchCharacterPersonality: false,
  matchCharacterDepthPrompt: false,
  matchScenario: false,
  matchCreatorNotes: false,
  delayUntilRecursion: 0,
  probability: 100,
  useProbability: true,
  depth: 4,
  group: "",
  groupOverride: false,
  groupWeight: 100,
  scanDepth: null,
  caseSensitive: null,
  matchWholeWords: null,
  useGroupScoring: null,
  automationId: "",
  role: 0,
  sticky: null,
  cooldown: null,
  delay: null
};
function toLorebookEntry(entry) {
  return {
    uid: entry.uid,
    display_index: entry.displayIndex,
    comment: entry.comment,
    enabled: !entry.disable,
    type: entry.constant ? "constant" : entry.vectorized ? "vectorized" : "selective",
    position: {
      0: "before_character_definition",
      1: "after_character_definition",
      5: "before_example_messages",
      6: "after_example_messages",
      2: "before_author_note",
      3: "after_author_note"
    }[entry.position] ?? (entry.role === 1 ? "at_depth_as_user" : entry.role === 2 ? "at_depth_as_assistant" : "at_depth_as_system"),
    depth: entry.position === 4 ? entry.depth : null,
    order: entry.order,
    probability: entry.probability,
    key: entry.key,
    keys: entry.key,
    logic: {
      0: "and_any",
      1: "not_all",
      2: "not_any",
      3: "and_all"
    }[entry.selectiveLogic],
    filter: entry.keysecondary,
    filters: entry.keysecondary,
    scan_depth: entry.scanDepth ?? "same_as_global",
    case_sensitive: entry.caseSensitive ?? "same_as_global",
    match_whole_words: entry.matchWholeWords ?? "same_as_global",
    use_group_scoring: entry.useGroupScoring ?? "same_as_global",
    automation_id: entry.automationId || null,
    exclude_recursion: entry.excludeRecursion,
    prevent_recursion: entry.preventRecursion,
    delay_until_recursion: entry.delayUntilRecursion,
    content: entry.content,
    group: entry.group,
    group_prioritized: entry.groupOverride,
    group_weight: entry.groupWeight,
    sticky: entry.sticky || null,
    cooldown: entry.cooldown || null,
    delay: entry.delay || null
  };
}
async function getLorebookEntries(lorebook, { filter = "none" } = {}) {
  if (!world_names.includes(lorebook)) {
    throw Error(`\u672A\u80FD\u627E\u5230\u4E16\u754C\u4E66 '${lorebook}'`);
  }
  const data = await loadWorldInfo(lorebook);
  let entries = _(data.entries).values().map(toLorebookEntry).value();
  if (filter !== "none") {
    entries = entries.filter(
      (entry) => Object.entries(filter).every(([field, expected_value]) => {
        const entry_value = entry[field];
        if (Array.isArray(entry_value)) {
          return expected_value.every((value) => entry_value.includes(value));
        }
        if (typeof entry_value === "string") {
          return entry_value.includes(expected_value);
        }
        return entry_value === expected_value;
      })
    );
  }
  return klona(entries);
}
function fromPartialLorebookEntry(entry) {
  const transformers = {
    uid: (value) => ({ uid: value }),
    display_index: (value) => ({ displayIndex: value }),
    comment: (value) => ({ comment: value }),
    enabled: (value) => ({ disable: !value }),
    type: (value) => ({
      constant: value === "constant",
      vectorized: value === "vectorized"
    }),
    position: (value) => ({
      position: {
        before_character_definition: 0,
        after_character_definition: 1,
        before_example_messages: 5,
        after_example_messages: 6,
        before_author_note: 2,
        after_author_note: 3,
        at_depth_as_system: 4,
        at_depth_as_user: 4,
        at_depth_as_assistant: 4
      }[value],
      role: _.get(
        {
          at_depth_as_system: 0,
          at_depth_as_user: 1,
          at_depth_as_assistant: 2
        },
        value,
        null
      )
    }),
    depth: (value) => ({ depth: value === null ? 4 : value }),
    order: (value) => ({ order: value }),
    probability: (value) => ({ probability: value }),
    keys: (value) => ({ key: value }),
    logic: (value) => ({
      selectiveLogic: {
        and_any: 0,
        not_all: 1,
        not_any: 2,
        and_all: 3
      }[value]
    }),
    filters: (value) => ({ keysecondary: value }),
    scan_depth: (value) => ({ scanDepth: value === "same_as_global" ? null : value }),
    case_sensitive: (value) => ({
      caseSensitive: value === "same_as_global" ? null : value
    }),
    match_whole_words: (value) => ({
      matchWholeWords: value === "same_as_global" ? null : value
    }),
    use_group_scoring: (value) => ({
      useGroupScoring: value === "same_as_global" ? null : value
    }),
    automation_id: (value) => ({ automationId: value === null ? "" : value }),
    exclude_recursion: (value) => ({ excludeRecursion: value }),
    prevent_recursion: (value) => ({ preventRecursion: value }),
    delay_until_recursion: (value) => ({ delayUntilRecursion: value }),
    content: (value) => ({ content: value }),
    group: (value) => ({ group: value }),
    group_prioritized: (value) => ({ groupOverride: value }),
    group_weight: (value) => ({ groupWeight: value }),
    sticky: (value) => ({ sticky: value === null ? 0 : value }),
    cooldown: (value) => ({ cooldown: value === null ? 0 : value }),
    delay: (value) => ({ delay: value === null ? 0 : value })
  };
  return _.merge(
    {},
    default_original_lorebook_entry,
    ...Object.entries(entry).filter(([_2, value]) => value !== void 0).map(([key, value]) => transformers[key]?.(value))
  );
}
var MAX_UID = 1e6;
function handleLorebookEntriesCollision(entries) {
  const uid_set = /* @__PURE__ */ new Set();
  const handle_uid_collision = (index) => {
    if (index === void 0) {
      index = _.random(0, MAX_UID - 1);
    }
    let i2 = 1;
    while (true) {
      if (!uid_set.has(index)) {
        uid_set.add(index);
        return index;
      }
      index = (index + i2 * i2) % MAX_UID;
      ++i2;
    }
  };
  let max_display_index = _.max(entries.map((entry) => entry.display_index ?? -1)) ?? -1;
  return entries.map((entry) => ({
    ...entry,
    uid: handle_uid_collision(entry.uid),
    display_index: entry.display_index ?? ++max_display_index
  }));
}
async function replaceLorebookEntries(lorebook, entries) {
  if (!world_names.includes(lorebook)) {
    throw Error(`\u672A\u80FD\u627E\u5230\u4E16\u754C\u4E66 '${lorebook}'`);
  }
  const data = {
    entries: _.merge(
      {},
      ...handleLorebookEntriesCollision(entries).map(fromPartialLorebookEntry).map((entry) => ({ [entry.uid]: entry }))
    )
  };
  await saveWorldInfo(lorebook, data);
  reloadEditorDebounced(lorebook);
}
async function updateLorebookEntriesWith(lorebook, updater) {
  await replaceLorebookEntries(lorebook, await updater(await getLorebookEntries(lorebook)));
  return getLorebookEntries(lorebook);
}
async function setLorebookEntries(lorebook, entries) {
  return await updateLorebookEntriesWith(lorebook, (data) => {
    for (const entry_to_set of entries) {
      const data_entry = data.find((entry) => entry.uid === entry_to_set.uid);
      if (data_entry) {
        _.merge(data_entry, entry_to_set);
      }
    }
    return data;
  });
}
async function createLorebookEntries(lorebook, entries) {
  const new_uids = [];
  const updated_entries = await updateLorebookEntriesWith(lorebook, (data) => {
    const uid_set = new Set(data.map((entry) => entry.uid));
    const get_free_uid = () => {
      for (let i2 = 0; i2 < MAX_UID; ++i2) {
        if (!uid_set.has(i2)) {
          uid_set.add(i2);
          new_uids.push(i2);
          return i2;
        }
      }
      throw Error(`\u65E0\u6CD5\u627E\u5230\u53EF\u7528\u7684\u4E16\u754C\u4E66\u6761\u76EE uid`);
    };
    entries.forEach((entry) => entry.uid = get_free_uid());
    return [...data, ...entries];
  });
  return { entries: updated_entries, new_uids };
}
async function deleteLorebookEntries(lorebook, uids) {
  let deleted = false;
  const updated_entires = await updateLorebookEntriesWith(lorebook, (data) => {
    const removed_data = _.remove(data, (entry) => uids.includes(entry.uid));
    deleted = removed_data.length > 0;
    return data;
  });
  return { entries: updated_entires, delete_occurred: deleted };
}
async function createLorebookEntry(lorebook, field_values) {
  return (await createLorebookEntries(lorebook, [field_values])).new_uids[0];
}
async function deleteLorebookEntry(lorebook, uid) {
  return (await deleteLorebookEntries(lorebook, [uid])).delete_occurred;
}

// vendor/tavern-helper/src/function/worldbook.ts
function getWorldbookNames() {
  return klona(world_names);
}
var _default_implicit_keys = {
  addMemo: true,
  matchPersonaDescription: false,
  matchCharacterDescription: false,
  matchCharacterPersonality: false,
  matchCharacterDepthPrompt: false,
  matchScenario: false,
  matchCreatorNotes: false,
  group: "",
  groupOverride: false,
  groupWeight: 100,
  caseSensitive: null,
  matchWholeWords: null,
  useGroupScoring: null,
  automationId: "",
  ignoreBudget: false,
  outletName: "",
  triggers: [],
  characterFilter: {
    isExclude: false,
    names: [],
    tags: []
  }
};
function toWorldbookEntry(entry) {
  let result = _({}).set("uid", entry.uid).set("name", entry.comment).set("enabled", !entry.disable).set("strategy.type", entry.constant ? "constant" : entry.vectorized ? "vectorized" : "selective").set(
    "strategy.keys",
    entry.key.map((value) => parseRegexFromString(value) ?? value)
  ).set("strategy.keys_secondary", {
    logic: { 0: "and_any", 1: "not_all", 2: "not_any", 3: "and_all" }[entry.selectiveLogic],
    keys: entry.keysecondary.map((value) => parseRegexFromString(value) ?? value)
  }).set("strategy.scan_depth", entry.scanDepth ?? "same_as_global").set(
    "position.type",
    {
      0: "before_character_definition",
      1: "after_character_definition",
      5: "before_example_messages",
      6: "after_example_messages",
      2: "before_author_note",
      3: "after_author_note",
      4: "at_depth",
      7: "outlet"
    }[entry.position]
  ).set("position.role", { 0: "system", 1: "user", 2: "assistant" }[entry.role ?? 0]).set("position.depth", entry.depth).set("position.order", entry.order).set("content", entry.content).set("probability", entry.useProbability ? entry.probability : 100).set("recursion.prevent_incoming", entry.excludeRecursion).set("recursion.prevent_outgoing", entry.preventRecursion).set(
    "recursion.delay_until",
    typeof entry.delayUntilRecursion === "number" && entry.delayUntilRecursion > 0 ? entry.delayUntilRecursion : null
  ).set("effect.sticky", typeof entry.sticky === "number" && entry.sticky > 0 ? entry.sticky : null).set("effect.cooldown", typeof entry.cooldown === "number" && entry.cooldown > 0 ? entry.cooldown : null).set("effect.delay", typeof entry.delay === "number" && entry.delay > 0 ? entry.delay : null);
  if (entry.extra) {
    result = result.set("extra", entry.extra);
  }
  result = result.merge(_.pick(entry, Object.keys(_default_implicit_keys)));
  return result.value();
}
function fromWorldbookEntry(entry, display_index) {
  let result = _({}).set("uid", entry.uid).set("displayIndex", display_index).set("comment", entry.name ?? "").set("disable", !(entry.enabled ?? true)).set("constant", entry?.strategy?.type ? entry?.strategy?.type === "constant" : true).set("selective", entry?.strategy?.type === "selective").set("key", entry?.strategy?.keys?.map(_.toString) ?? []).set(
    "selectiveLogic",
    {
      and_any: 0,
      not_all: 1,
      not_any: 2,
      and_all: 3
    }[entry?.strategy?.keys_secondary?.logic ?? "and_any"]
  ).set("keysecondary", entry?.strategy?.keys_secondary?.keys?.map(_.toString) ?? []).set("scanDepth", entry?.strategy?.scan_depth === "same_as_global" ? null : entry?.strategy?.scan_depth ?? null).set("vectorized", entry?.strategy?.type === "vectorized").set(
    "position",
    {
      before_character_definition: 0,
      after_character_definition: 1,
      before_example_messages: 5,
      after_example_messages: 6,
      before_author_note: 2,
      after_author_note: 3,
      at_depth: 4,
      outlet: 7
    }[entry?.position?.type ?? "at_depth"]
  ).set("role", { system: 0, user: 1, assistant: 2 }[entry?.position?.role ?? "system"]).set("depth", entry?.position?.depth ?? 4).set("order", entry?.position?.order ?? 100).set("content", entry.content ?? "").set("useProbability", true).set("probability", entry.probability ?? 100).set("excludeRecursion", entry.recursion?.prevent_incoming ?? false).set("preventRecursion", entry.recursion?.prevent_outgoing ?? false).set("delayUntilRecursion", entry.recursion?.delay_until ?? false).set("sticky", entry.effect?.sticky ?? null).set("cooldown", entry.effect?.cooldown ?? null).set("delay", entry.effect?.delay ?? null);
  if (entry.extra) {
    result = result.set("extra", entry.extra);
  }
  result = result.merge(_default_implicit_keys).merge(_.pick(entry, Object.keys(_default_implicit_keys)));
  return result.value();
}
function handleWorldbookEntriesCollision(entries) {
  const MAX_UID2 = 1e6;
  const uid_set = /* @__PURE__ */ new Set();
  const handle_uid_collision = (index) => {
    if (index === void 0) {
      index = _.random(0, MAX_UID2 - 1);
    }
    let i2 = 1;
    while (true) {
      if (!uid_set.has(index)) {
        uid_set.add(index);
        return index;
      }
      index = (index + i2 * i2) % MAX_UID2;
      ++i2;
    }
  };
  return entries.map((entry) => ({
    ...entry,
    uid: handle_uid_collision(entry.uid)
  }));
}
async function getWorldbook(worldbook_name) {
  if (!getWorldbookNames().includes(worldbook_name)) {
    throw Error(`\u672A\u80FD\u627E\u5230\u4E16\u754C\u4E66 '${worldbook_name}'`);
  }
  const original_worldbook_entries = await loadWorldInfo(worldbook_name).then(
    (data) => data ?? {}
  );
  return klona(_(original_worldbook_entries.entries).values().sortBy("displayIndex").map(toWorldbookEntry).value());
}
async function createOrReplaceWorldbook(worldbook_name, worldbook = [], { render = "debounced" } = {}) {
  const is_existing = getWorldbookNames().includes(worldbook_name);
  if (!getWorldbookNames().includes(worldbook_name)) {
    const success = await createNewWorldInfo(worldbook_name, { interactive: false });
    if (!success) {
      return false;
    }
  }
  if (is_existing || worldbook.length > 0) {
    await saveWorldInfo(worldbook_name, {
      entries: _.merge(
        {},
        ..._(handleWorldbookEntriesCollision(worldbook)).map(fromWorldbookEntry).map((entry) => ({ [entry.uid]: entry })).value()
      )
    });
    switch (render) {
      case "debounced":
        reloadEditorDebounced(worldbook_name);
        break;
      case "immediate":
        reloadEditor(worldbook_name);
        break;
    }
  }
  return !is_existing;
}
async function replaceWorldbook(worldbook_name, worldbook, options) {
  if (!getWorldbookNames().includes(worldbook_name)) {
    throw Error(`\u672A\u80FD\u627E\u5230\u4E16\u754C\u4E66 '${worldbook_name}'`);
  }
  await createOrReplaceWorldbook(worldbook_name, worldbook, options);
}
async function updateWorldbookWith(worldbook_name, updater, options) {
  await replaceWorldbook(worldbook_name, await updater(await getWorldbook(worldbook_name)), options);
  return await getWorldbook(worldbook_name);
}
async function createWorldbookEntries(worldbook_name, new_entries, options) {
  let slice_start;
  const worldbook = await updateWorldbookWith(
    worldbook_name,
    (data) => {
      slice_start = data.length;
      return [...data, ...new_entries];
    },
    options
  );
  return { worldbook, new_entries: worldbook.slice(slice_start) };
}
async function deleteWorldbookEntries(worldbook_name, predicate, options) {
  let deleted_entries = [];
  const worldbook = await updateWorldbookWith(
    worldbook_name,
    (data) => {
      deleted_entries = _.remove(data, predicate);
      return data;
    },
    options
  );
  return { worldbook, deleted_entries };
}

// src/helper-entry.js
window.klona = klona2;
var api = Object.fromEntries(Object.entries({ ...preset_exports, ...tavern_regex_exports, ...global_exports, ...util_exports2, ...version_exports, ...lorebook_entry_exports, getWorldbook, replaceWorldbook, updateWorldbookWith, createWorldbookEntries, deleteWorldbookEntries }).filter(([key, value]) => !key.startsWith("_") && typeof value === "function"));
var { tavern_events: tavern_events2, iframe_events: iframe_events2 } = event_exports;
function bind(target) {
  const bound = Object.fromEntries(Object.entries({ ...event_exports, ...global_exports, ...util_exports2 }).filter(([key, value]) => key.startsWith("_") && typeof value === "function").map(([key, value]) => [key.slice(1), value.bind(target)]));
  for (const name of ["eventOn", "eventOnce", "eventMakeFirst", "eventMakeLast"]) {
    const register = bound[name];
    bound[name] = (event, listener) => ({ ...register(event, listener), stop: () => bound.eventRemoveListener(event, listener) });
  }
  Object.assign(target, bound);
  return bound;
}
export {
  api,
  bind,
  fromCharacterBook,
  iframe_events2 as iframe_events,
  newWorldInfoEntryTemplate,
  tavern_events2 as tavern_events
};
