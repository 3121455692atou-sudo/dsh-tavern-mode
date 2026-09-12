const host = window.__tavernHelperHost;
const context = host.context;
export const chat = context.chat, characters = context.characters, extension_settings = context.extension_settings;
export const eventSource = context.eventSource, event_types = context.event_types, this_chid = 0;
export const version = context.version;
export const saveSettings = () => host.saveSettings();
export const saveSettingsDebounced = () => host.saveSettings().catch(host.report);
export const substituteParams = text => host.substituteParams(text);
export const substituteParamsExtended = substituteParams;
export const getCurrentChatId = () => context.chatId;
export const uuidv4 = () => crypto.randomUUID();
export const promptManager = host.promptManager;
export const oai_settings = host.oaiSettings;
export const preset_manager = host.presetManager;
export const getCompletionPresetByName = name => host.getPreset(name);
export const getRegexedString = (text, placement, options) => host.regex(text, placement, options);
export const regex_placement = { USER_INPUT: 1, AI_OUTPUT: 2, SLASH_COMMAND: 3, WORLD_INFO: 5, REASONING: 6 };
export const writeExtensionField = (id, key, value) => host.writeExtensionField(id, key, value);
export const refreshOneMessage = index => host.refreshOneMessage(index);
export const macros = [];
export const RawCharacter = { findIndex: name => name === 'current' || name === context.name2 ? 0 : -1 };
export function _getButtonEvent(name) { return host.getButtonEvent(this, name); }
export const getTavernHelperExtensionId = () => 'N0VI028/JS-Slash-Runner';
export const updateExtension = async id => {
  if (id !== getTavernHelperExtensionId()) throw new Error('未连接该扩展的更新服务');
  await host.update();
  return new Response(null, { status: 200 });
};
export const extension_prompt_roles = { SYSTEM: 0, USER: 1, ASSISTANT: 2 };
export const getRequestHeaders = () => ({ 'content-type': 'application/json' });
export { DEFAULT_DEPTH, DEFAULT_WEIGHT, newWorldInfoEntryTemplate, world_info_logic, world_info_position, parseRegexFromString } from '../vendor/tavern-helper/host/world-info.js';
export const world_names = new Proxy(host.getWorldbookNames(), { get: (_names, key) => Reflect.get(host.getWorldbookNames(), key) });
export const loadWorldInfo = name => host.loadWorldInfo(name);
export const saveWorldInfo = (name, data) => host.saveWorldInfo(name, data);
export function createNewWorldInfo() { throw new Error('当前宿主未连接创建世界书接口'); }
export const getCharLorebooks = options => host.getCharLorebooks(options);
export const selected_world_info = host.selectedWorldbooks;
function unsupportedWorldbookBinding() { throw new Error('当前宿主未连接世界书绑定接口'); }
export { unsupportedWorldbookBinding as getChatLorebook, unsupportedWorldbookBinding as getOrCreateChatLorebook, unsupportedWorldbookBinding as setChatLorebook, unsupportedWorldbookBinding as setCurrentCharLorebooks, unsupportedWorldbookBinding as getWorldInfoSettings };
export function deleteWorldInfo() { throw new Error('当前宿主未连接删除世界书接口'); }
