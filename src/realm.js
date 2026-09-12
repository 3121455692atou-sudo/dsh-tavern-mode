import $ from 'jquery';
import _ from 'lodash';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import * as z from 'zod';
import * as YAML from 'yaml';
import * as Vue from 'vue';
import * as VueRouter from 'vue-router';
import { allRegex, applyRegex, expandMacros, macroEnvironment } from './macros.js';
import { toHelperPreset, fromHelperPreset } from './presets.js';
import { avatarAlias } from './runtime-snapshot.js';
import { installStorage, bubbleRecord } from './runtime-storage.js';
import builtinBubbleScript from '../vendor/bubble-script.json';
import { displaySegments } from './display.js';
import { withoutLegacyBubble } from './speech-frame.js';
import { activateWorldbookWithEvents, toWorldInfoEntry } from './worldbook.js';

Object.assign(window, { $, jQuery: $, _, lodash: _, z, YAML, Vue, VueRouter });
let port, payload, storage, initialized = false, rendering = Promise.resolve(), running = false;
let processedMessageId;
const pending = new Map(), listeners = Object.create(null), injections = new Map(), templateMacros = new Map(), buttons = new Map();
const pendingWrites = new Set();
let savedPreset = '';
let officialHelper;
const urls = new Set();
const componentWindows = new Set();
const viewportSizes = new WeakMap();
const nativeFetch = window.fetch.bind(window), preparedHtml = new Map();
window.__tavernHost = window;
async function compileFrontend(code) {
  const result = await nativeFetch('/compile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(code) }).then(response => response.json());
  if (result.error) throw new Error(result.error);
  return result.code;
}
async function prepareFrontendHtml(source) {
  if (preparedHtml.has(source)) return preparedHtml.get(source);
  const document = new DOMParser().parseFromString(source, 'text/html');
  const scripts = [...document.querySelectorAll('script:not([src])')].filter(script => !script.type || ['module', 'text/javascript', 'application/javascript'].includes(script.type));
  const compiled = await compileFrontend(scripts.map(script => script.textContent));
  scripts.forEach((script, index) => { script.textContent = compiled[index].replaceAll('</script', '<\\/script'); });
  const bridge = document.createElement('script'); bridge.textContent = 'if(!window.__tavernHost)parent.__tavernExpose?.(window,-1);'; document.head.prepend(bridge);
  const result = '<!doctype html>\n' + document.documentElement.outerHTML;
  preparedHtml.set(source, result); return result;
}
async function frontendFetch(input, options, base = document.baseURI) {
  const response = await nativeFetch(typeof input === 'string' ? new URL(input, base) : input, options);
  if (response.ok && response.headers.get('content-type')?.includes('text/html')) await prepareFrontendHtml(await response.clone().text());
  return response;
}
window.fetch = frontendFetch;
const srcdoc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc');
Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', { ...srcdoc, set(value) { srcdoc.set.call(this, preparedHtml.get(value) ?? value); } });
const scriptWindows = new Map(), scriptRecords = new Map(), readyTasks = new Set(), variableSchemas = new Map();
const runtimeErrors = [];
const deferredDeletes = new Set();
const notify = (type, value = {}) => port.postMessage({ type, ...value });
const report = error => { const message = error?.message ?? String(error); if (runtimeErrors.length < 20) runtimeErrors.push(message); notify('error', { message }); };
const clone = value => structuredClone(value);
const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function installUiSurface() {
  const settings = document.createElement('section'); settings.id = 'tavern-script-settings'; settings.hidden = true;
  settings.style.cssText = 'position:fixed;inset:16px;z-index:20000;overflow:auto;background:var(--tavern-bubble,#202128);color:var(--tavern-color,#ddd);padding:16px;border-radius:12px;box-shadow:0 12px 50px #0004';
  const close = document.createElement('button'); close.textContent = '关闭脚本设置';
  close.style.cssText = 'display:block;margin:0 0 16px auto;color:inherit;background:transparent;border:1px solid currentColor;border-radius:6px;padding:6px 12px';
  close.onclick = () => { settings.hidden = true; };
  settings.append(close, document.getElementById('script-buttons'), document.getElementById('extensions_settings2'));
  document.body.append(settings);
  let scheduled = false, previous = '';
  const resize = new ResizeObserver(schedule);
  const observed = new WeakSet();
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const rectangles = [];
      function visit(element) {
        if (!(element instanceof HTMLElement)) return;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.opacity === '0' && style.pointerEvents === 'none') return;
        const rect = element.getBoundingClientRect();
        const left = Math.max(0, rect.left), top = Math.max(0, rect.top), right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
        if (style.visibility !== 'hidden' && right > left && bottom > top) {
          const next = { left, top, width: right - left, height: bottom - top };
          if (!rectangles.some(value => value.left <= left && value.top <= top && value.left + value.width >= right && value.top + value.height >= bottom)) rectangles.push(next);
          if (left === 0 && top === 0 && right === innerWidth && bottom === innerHeight) return;
        }
        for (const child of element.children) visit(child);
      }
      for (const element of document.body.children) {
        if (!observed.has(element)) { observed.add(element); resize.observe(element); }
        visit(element);
      }
      const value = JSON.stringify(rectangles);
      if (value !== previous) { previous = value; notify('ui', { rectangles }); }
    });
  }
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true });
  window.addEventListener('resize', schedule);
  schedule();
}
function trackReady(task, label = '初始化回调') { task.label = label; readyTasks.add(task); task.finally(() => readyTasks.delete(task)).catch(report); return task; }
window.__tavernPending = () => [...readyTasks].map(task => task.label);
const inlineModules = new WeakSet(), moduleCompletions = new Map();
window.__tavernModuleReady = id => { moduleCompletions.get(id)?.(); moduleCompletions.delete(id); };
function trackInlineModule(node) {
  if (node?.tagName !== 'SCRIPT' || node.type !== 'module' || node.src || inlineModules.has(node)) return;
  inlineModules.add(node);
  const id = crypto.randomUUID();
  trackReady(new Promise((resolve, reject) => {
    moduleCompletions.set(id, resolve);
    node.addEventListener('error', () => { moduleCompletions.delete(id); reject(new Error(`内联模块加载失败：${node.id}`)); }, { once: true });
  }), node.id || '内联模块');
  node.textContent += `\n;window.__tavernModuleReady(${JSON.stringify(id)});\n`;
}
// Inline modules do not emit a load event. Mark completion after their native
// module evaluation; keep imports relative to the original document URL.
for (const [prototype, methods] of [[Node.prototype, ['appendChild', 'insertBefore', 'replaceChild']], [Element.prototype, ['append', 'prepend', 'before', 'after', 'replaceWith']]]) {
  for (const method of methods) {
    const original = prototype[method];
    prototype[method] = function(...args) {
      if (this.isConnected) for (const node of method === 'insertBefore' || method === 'replaceChild' ? args.slice(0, 1) : args) trackInlineModule(node);
      return original.apply(this, args);
    };
  }
}
const parentJquery = (value, scope) => {
  if (typeof value !== 'function') return $(value, scope);
  trackReady(Promise.resolve().then(() => value(parentJquery))); return $(document);
};
Object.assign(parentJquery, $); parentJquery.fn = $.fn;
window.$ = window.jQuery = parentJquery;

function rpc(method, args) {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`酒馆接口 ${method} 响应超时`)); }, method === 'generate' ? 600000 : 120000);
    pending.set(id, { resolve, reject, timer });
    notify('rpc', { id, method, args });
  });
}
function write(method, args) {
  const promise = rpc(method, args);
  pendingWrites.add(promise);
  promise.finally(() => pendingWrites.delete(promise)).catch(report);
  return promise;
}
function eventOn(type, callback, first = false) {
  const callbacks = listeners[type] ??= [];
  if (!callbacks.includes(callback)) { if (first) callbacks.unshift(callback); else callbacks.push(callback); }
  const stop = () => { const i = callbacks.indexOf(callback); if (i >= 0) callbacks.splice(i, 1); };
  return Object.assign(stop, { stop });
}
function eventRemove(type, callback) { const array = listeners[type] ?? []; const i = array.findIndex(listener => listener === callback || listener.listener === callback); if (i >= 0) array.splice(i, 1); }
async function eventEmit(type, ...args) { for (const fn of [...(listeners[type] ?? [])]) await fn(...args); }
const event_types = Object.fromEntries([
  'CHAT_CHANGED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'USER_MESSAGE_RENDERED', 'CHARACTER_MESSAGE_RENDERED', 'MORE_MESSAGES_LOADED',
  'GENERATION_STARTED', 'GENERATION_AFTER_COMMANDS', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'STREAM_TOKEN_RECEIVED',
  'WORLDINFO_SCAN_DONE', 'WORLD_INFO_ACTIVATED', 'WORLDINFO_UPDATED', 'GENERATE_AFTER_DATA', 'CHAT_COMPLETION_SETTINGS_READY', 'TEXT_COMPLETION_SETTINGS_READY', 'CHAT_COMPLETION_PROMPT_READY', 'OAI_PRESET_IMPORT_READY', 'OAI_PRESET_CHANGED_AFTER', 'PRESET_CHANGED', 'PRESET_RENAMED_BEFORE', 'PRESET_RENAMED', 'SETTINGS_LOADED', 'SETTINGS_UPDATED', 'APP_READY',
].map(key => [key, key === 'CHAT_CHANGED' ? 'chat_id_changed' : key === 'GENERATION_AFTER_COMMANDS' ? key : key.toLowerCase()]));
function eventEmitAndWait(type, ...args) {
  for (const fn of [...(listeners[type] ?? [])]) {
    try { const result = fn(...args); if (result?.then) Promise.resolve(result).catch(report); }
    catch (error) { report(error); }
  }
}
function eventOnce(type, callback) {
  const wrapped = Object.assign((...args) => { eventRemove(type, wrapped); return callback(...args); }, { listener: callback });
  return eventOn(type, wrapped);
}
const eventSource = { events: listeners, on: eventOn, once: eventOnce, emit: eventEmit, emitAndWait: eventEmitAndWait, makeFirst: (type, callback) => { eventRemove(type, callback); return eventOn(type, callback, true); }, makeLast: (type, callback) => { eventRemove(type, callback); return eventOn(type, callback); }, removeListener: eventRemove, off: eventRemove };
const context = { mainApi: 'openai', characterId: 0, this_chid: 0, selected_group: null, chat: [], chat_metadata: {}, extension_settings: { variables: { global: {} } }, power_user: {}, eventSource, event_types };
context.powerUserSettings = context.power_user;
Object.defineProperty(context, 'extensionSettings', { get: () => context.extension_settings });
context.eventTypes = event_types;
context.POPUP_TYPE = { TEXT: 1, CONFIRM: 2, INPUT: 3 };
context.POPUP_RESULT = { AFFIRMATIVE: 1, NEGATIVE: 0, CANCELLED: null };
context.t = (parts, ...values) => String.raw({ raw: parts }, ...values);
context.uuidv4 = () => crypto.randomUUID();
context.isMobile = () => matchMedia('(max-width: 600px)').matches;

function env() { return macroEnvironment({ ...variableSnapshot(), user: payload.state.userName, char: payload.card.name, messages: context.chat.map(m => ({ role: m.is_user ? 'user' : 'assistant', content: m.mes })), messageSwipes: Object.fromEntries(context.chat.map((message, index) => [index, message.swipe_id ?? 0])), sessionId: payload.state.id, customMacros: Object.fromEntries([...templateMacros].map(([key, fn]) => [key, fn()])) }); }
function scope(options = {}) {
  if (options.type === 'global') return payload.state.globalVariables ??= {};
  if (options.type === 'character') return payload.state.characterVariables ??= {};
  if (options.type === 'preset') return payload.state.presetVariables ??= {};
  if (options.type === 'extension') return context.extension_settings[options.extension_id] ??= {};
  if (options.type === 'message') {
    const message = context.chat[messageIndex(options.message_id)];
    message.variables ??= [{}];
    return message.variables[message.swipe_id ?? 0] ??= {};
  }
  if (options.type === 'script') return (payload.state.scriptVariables ??= {})[options.script_id ?? 'default'] ??= {};
  return context.chat_metadata.variables ??= {};
}
function messageIndex(id) {
  if (id === undefined || id === 'latest') id = context.chat.findLastIndex(message => !message.is_system);
  if (id < 0) id = context.chat.length + id;
  if (!Number.isInteger(id) || !context.chat[id]) throw new Error(`消息楼层不存在：${id}`);
  return id;
}
function variableSnapshot() {
  context.extension_settings.__tavern_power_user = clone(context.power_user);
  return { variables: context.chat_metadata.variables ?? {}, globalVariables: payload.state.globalVariables ?? {}, characterVariables: payload.state.characterVariables ?? {}, presetVariables: payload.state.presetVariables ?? {}, scriptVariables: payload.state.scriptVariables ?? {}, extensionSettings: context.extension_settings, messageVariables: Object.fromEntries(context.chat.map((message, index) => [index, clone(message.variables ?? [{}])])) };
}
function generationSnapshot() {
  return { ...variableSnapshot(), worldbookOverrides: payload.state.worldbookOverrides ?? {}, worldbookSettings: payload.state.worldbookSettings ?? {}, regexOrder: window.__regexScriptOrder ?? payload.state.regexOrder, ...(payload.state.presetId ? { presetOverride: snapshotPreset() } : {}) };
}
function syncVariables() {
  if (running) return Promise.resolve();
  return write('variables', variableSnapshot());
}
function replaceVariables(value, options) {
  const replacement = clone(value);
  const target = scope(options);
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, replacement);
  syncVariables().catch(report);
  return clone(target);
}
function updateVariablesWith(update, options) {
  const result = update(clone(scope(options)));
  return result?.then ? result.then(value => replaceVariables(value, options)) : replaceVariables(result, options);
}
function rangeIds(range) {
  if (range === undefined || range === null) return context.chat.map((_, i) => i);
  const raw = expandMacros(String(range), env()).trim();
  if (/^-?\d+$/.test(raw)) { const n = Number(raw); return [n < 0 ? context.chat.length + n : n]; }
  const match = raw.match(/^(-?\d+)\s*-\s*(-?\d+)$/);
  if (!match) throw new Error(`消息范围无效：${raw}`);
  const ends = match.slice(1).map(Number).map(n => n < 0 ? context.chat.length + n : n);
  return context.chat.map((_, i) => i).filter(i => i >= ends[0] && i <= ends[1]);
}
function getChatMessages(range, options = {}) {
  return rangeIds(range).filter(i => context.chat[i]).map(message_id => {
    const m = context.chat[message_id];
    return { message_id, name: m.name, role: m.is_user ? 'user' : m.extra?.type === 'narrator' ? 'system' : 'assistant', message: m.mes, is_hidden: !!m.is_system, swipe_id: m.swipe_id ?? 0, swipes: clone(m.swipes ?? [m.mes]), swipes_data: clone(m.variables ?? [{}]), swipes_info: clone(m.swipe_info ?? [{}]), data: clone(m.variables?.[m.swipe_id ?? 0] ?? {}), extra: clone(m.extra ?? {}) };
  }).filter(m => (!options.role || options.role === 'all' || m.role === options.role) && (!options.hide_state || options.hide_state === 'all' || m.is_hidden === (options.hide_state === 'hidden')));
}
async function setChatMessages(messages, options = {}) {
  for (const item of messages) {
    const current = context.chat[messageIndex(item.message_id)];
    for (const [from, to] of [['swipes', 'swipes'], ['swipe_id', 'swipe_id'], ['swipes_data', 'variables'], ['swipes_info', 'swipe_info'], ['extra', 'extra'], ['is_hidden', 'is_system']]) if (item[from] !== undefined) current[to] = clone(item[from]);
    if (item.message !== undefined) { current.mes = String(item.message); if (current.swipes) current.swipes[current.swipe_id ?? 0] = current.mes; }
    else if (item.swipe_id !== undefined || item.swipes !== undefined) current.mes = current.swipes?.[current.swipe_id ?? 0] ?? current.mes;
    if (item.name !== undefined) current.name = String(item.name);
    if (item.data !== undefined) { current.variables ??= [{}]; current.variables[current.swipe_id ?? 0] = clone(item.data); }
  }
  if (!running) await write('editChat', { chat: context.chat });
  if (!payload.native && options.refresh !== 'none') await renderChat();
  if (options.refresh !== 'none') for (const item of messages) {
    const index = messageIndex(item.message_id);
    await eventEmit(context.chat[index].is_user ? event_types.USER_MESSAGE_RENDERED : event_types.CHARACTER_MESSAGE_RENDERED, index);
  }
  return getChatMessages();
}
async function setChatMessage(value, message_id, { swipe_id = 'current', refresh = 'display_and_render_current' } = {}) {
  const message = context.chat[messageIndex(message_id)];
  const fields = typeof value === 'string' ? { message: value } : value;
  const target = swipe_id === 'current' ? message.swipe_id ?? 0 : swipe_id;
  if (!Number.isSafeInteger(target) || target < 0) throw new Error('消息页编号无效');
  const swipes = [...(message.swipes ?? [message.mes])], data = clone(message.variables ?? [{}]);
  while (swipes.length <= target) { swipes.push(''); data.push({}); }
  if (fields.message !== undefined) swipes[target] = expandMacros(String(fields.message), env());
  if (fields.data !== undefined) data[target] = clone(fields.data);
  await setChatMessages([{ message_id, swipes, swipes_data: data, swipe_id: refresh === 'none' ? message.swipe_id ?? 0 : target }], { refresh: refresh === 'none' ? 'none' : 'affected' });
}
async function createChatMessages(messages, options = {}, messageEvent) {
  if (running) throw new Error('请等待当前生成完成后再增添消息');
  const requested = options.insert_at ?? options.insert_before ?? 'end';
  const before = requested === 'end' ? context.chat.length : Math.max(0, Math.min(context.chat.length, requested < 0 ? context.chat.length + requested : requested));
  const input = messages.map(message => ({ ...message, name: message.name ?? (message.role === 'system' ? 'system' : message.role === 'user' ? payload.state.userName : payload.card.name) }));
  const { created } = await write('createChat', { messages: input, before });
  payload.state.messages.splice(before, 0, ...created);
  context.chat.splice(before, 0, ...created.map((message, index) => ({ name: message.name, is_user: message.role === 'user', is_system: message.is_hidden ?? false, mes: message.content, extra: message.extra, tavernMessageId: message.id, variables: [input[index].data ?? {}] })));
  if (!payload.native && options.refresh !== 'none') await renderChat();
  for (let index = before; index < before + created.length; index++) {
    const sent = messageEvent === event_types.MESSAGE_SENT || context.chat[index].is_user;
    await eventEmit(messageEvent ?? (sent ? event_types.MESSAGE_SENT : event_types.MESSAGE_RECEIVED), index, 'extension');
    await eventEmit(sent ? event_types.USER_MESSAGE_RENDERED : event_types.CHARACTER_MESSAGE_RENDERED, index);
  }
}
async function deleteChatMessages(ids) {
  const messages = ids.map(id => context.chat[messageIndex(id)]);
  if (messages.some(message => !message.tavernMessageId)) throw new Error('该消息正在写入，请等待本轮完成');
  const targets = messages.map(message => message.tavernMessageId);
  if (running) { for (const id of targets) deferredDeletes.add(id); return; }
  await write('deleteChat', { ids: targets });
  context.chat = context.chat.filter(message => !targets.includes(message.tavernMessageId));
  payload.state.messages = payload.state.messages.filter(message => !targets.includes(message.id));
  payload.state.messageVariables = Object.fromEntries(context.chat.map((message, index) => [index, message.variables ?? [{}]]));
  if (!payload.native) await renderChat();
  await eventEmit(event_types.MESSAGE_DELETED, context.chat.length);
}
function setDraft(text) {
  const textarea = document.getElementById('send_textarea');
  textarea.value = String(text ?? '');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  notify('draft', { text: textarea.value });
}
async function send(text, trigger = 'normal') {
  await Promise.all([...pendingWrites]);
  notify('send', { text: text ?? document.getElementById('send_textarea').value, trigger });
}

function splitCommands(value) {
  const commands = []; let quote = '', escaped = false, current = '';
  for (const c of value) {
    if (escaped) { current += c; escaped = false; continue; }
    if (c === '\\') { current += c; escaped = true; continue; }
    if (quote) { current += c; if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { current += c; quote = c; continue; }
    if (c === '|') { commands.push(current.trim()); current = ''; } else current += c;
  }
  if (quote) throw new Error('斜杠命令引号不完整');
  if (current.trim()) commands.push(current.trim());
  return commands;
}
async function executeSlashCommands(script) {
  let pipe = '', draft;
  for (const source of splitCommands(expandMacros(String(script), env()))) {
    const match = source.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
    if (!match) throw new Error(`斜杠命令格式无效：${source}`);
    const command = match[1].toLowerCase();
    let value = (match[2] ?? '').replaceAll('{{pipe}}', pipe);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    value = value.replace(/\\([\\|nrt"'])/g, (_, escaped) => ({ n: '\n', r: '\r', t: '\t' }[escaped] ?? escaped));
    if (command === 'send' || command === 'setinput') { draft = value; setDraft(value); pipe = value; }
    else if (command === 'sys' || command === 'nar') { await createChatMessages([{ role: 'system', message: value }], {}, event_types.MESSAGE_SENT); draft = ''; }
    else if (command === 'trigger' || command === 'gen') await send(draft, 'normal');
    else if (command === 'continue') await send('', 'continue');
    else if (command === 'cut') await deleteChatMessages(rangeIds(value));
    else if (command === 'getvar') pipe = String(_.get(scope(), value, ''));
    else if (command === 'setvar') { const m = value.match(/^key=(?:"([^"]*)"|'([^']*)'|(\S+))\s*([\s\S]*)$/); if (!m) throw new Error('/setvar 需要 key=变量名 值'); _.set(scope(), m[1] ?? m[2] ?? m[3], m[4]); await syncVariables(); }
    else if (command === 'echo') { pipe = value; notify('notice', { message: value }); }
    else if (command === 'flushinject') { injections.clear(); pipe = ''; }
    else throw new Error(`尚未实现斜杠命令 /${command}`);
  }
  return { pipe };
}

function currentPreset(name = 'in_use') {
  if (name !== 'in_use') {
    const preset = payload.presets.find(p => p.name === name || p.id === name);
    if (!preset?.data) throw new Error(`预设未加载：${name}`);
    return toHelperPreset(preset.data);
  }
  return toHelperPreset(context.chatCompletionSettings ? snapshotPreset() : payload.preset ?? { prompts: [], prompt_order: [] });
}
async function replacePreset(name, value) {
  const target = name === 'in_use' ? payload.state.presetId : payload.presets.find(p => p.name === name || p.id === name)?.id;
  if (!target) throw new Error('当前会话尚未绑定预设');
  const original = name === 'in_use' ? payload.preset : payload.presets.find(p => p.id === target)?.data;
  const data = fromHelperPreset(value, original);
  if (!(running && name === 'in_use')) await write('preset', { id: target, data, inUse: name === 'in_use' });
  if (name === 'in_use') { payload.preset = data; syncPreset(data, payload.presetName); }
  else { const cached = payload.presets.find(p => p.id === target); if (cached) cached.data = data; }
  return currentPreset(name);
}
async function createOrReplacePreset(name, value = { settings: {}, prompts: [], prompts_unused: [] }) {
  if (name === 'in_use' || payload.presets.some(p => p.name === name)) { await replacePreset(name, value); return false; }
  const item = await write('createPreset', { name, data: fromHelperPreset(value) });
  payload.presets.push(item);
  return true;
}
function loadPreset(name) {
  const item = payload.presets.find(p => p.name === name);
  if (!item) return false;
  payload.state.presetId = item.id; payload.preset = clone(item.data); payload.presetName = item.name;
  syncPreset(item.data, item.name);
  write('loadPreset', { id: item.id }).then(() => eventEmit(event_types.OAI_PRESET_CHANGED_AFTER, item.name)).catch(report);
  return true;
}
function getPresetManager(type) {
  if (type === 'reasoning') {
    const presets = context.power_user.reasoning_presets ??= {};
    return {
      getSelectedPresetName: () => context.power_user.reasoning?.name ?? '',
      getPresetNames: () => Object.keys(presets), getPresetList: () => Object.keys(presets),
      getPreset: name => clone(presets[name]),
      async savePreset(name, value) {
        presets[name] = { ...clone(value), name };
        Object.assign(context.power_user.reasoning, presets[name]);
        await syncVariables(); return clone(presets[name]);
      },
    };
  }
  return { getSelectedPresetName: () => payload.presetName ?? '', getPresetNames: () => payload.presets.map(p => p.name), getCompletionPresetByName: name => currentPreset(name), getPreset: name => currentPreset(name), getPresetList: () => payload.presets.map(p => p.name) };
}

function runtimeRegex() { return allRegex(payload.card, context.chatCompletionSettings, context.extension_settings.regex ?? payload.globalRegex ?? [], window.__regexScriptOrder ?? payload.state.regexOrder); }
function publishRegex() { payload.regex = runtimeRegex(); notify('regex', { regex: clone(payload.regex) }); }
const regexSources = { user_input: 1, ai_output: 2, slash_command: 3, world_info: 5, reasoning: 6 };
function getTavernRegexes(options = {}) {
  const scopes = options.type ? [options.type] : options.scope && options.scope !== 'all' ? [options.scope] : ['global', 'character'];
  return scopes.flatMap(scope => {
    const raw = scope === 'global' ? context.extension_settings.regex ?? [] : scope === 'character' ? payload.card.extensions?.regex_scripts ?? [] : currentPreset(options.name).extensions.regex_scripts ?? [];
    return raw.map(regex => ({
      id: regex.id, script_name: regex.scriptName, enabled: !regex.disabled, ...(options.type ? {} : { scope }),
      find_regex: regex.findRegex, replace_string: regex.replaceString, trim_strings: regex.trimStrings ?? [],
      source: Object.fromEntries(Object.entries(regexSources).map(([key, placement]) => [key, regex.placement?.includes(placement) ?? false])),
      destination: { display: !!regex.markdownOnly, prompt: !!regex.promptOnly }, run_on_edit: !!regex.runOnEdit, min_depth: regex.minDepth ?? null, max_depth: regex.maxDepth ?? null,
    }));
  }).filter(regex => !options.enable_state || options.enable_state === 'all' || regex.enabled === (options.enable_state === 'enabled'));
}
async function replaceTavernRegexes(regexes, options = {}) {
  if (!options.type) {
    for (const type of options.scope && options.scope !== 'all' ? [options.scope] : ['global', 'character']) await replaceTavernRegexes(regexes.filter(regex => (regex.scope ?? options.scope) === type), { type });
    return;
  }
  const originals = options.type === 'global' ? context.extension_settings.regex ?? [] : options.type === 'character' ? payload.card.extensions?.regex_scripts ?? [] : currentPreset(options.name).extensions.regex_scripts ?? [];
  const raw = regexes.map(regex => ({
    ...originals.find(original => original.id === regex.id), id: regex.id, scriptName: regex.script_name, disabled: !regex.enabled,
    findRegex: regex.find_regex, replaceString: regex.replace_string, trimStrings: regex.trim_strings ?? [],
    placement: Object.entries(regexSources).filter(([key]) => regex.source[key]).map(([, value]) => value),
    markdownOnly: regex.destination.display, promptOnly: regex.destination.prompt, runOnEdit: regex.run_on_edit, minDepth: regex.min_depth, maxDepth: regex.max_depth,
  }));
  if (options.type === 'global') { context.extension_settings.regex = raw; await saveSettings(); }
  else if (options.type === 'preset') { const preset = currentPreset(options.name); preset.extensions.regex_scripts = raw; await replacePreset(options.name ?? 'in_use', preset); context.chatCompletionSettings.extensions = clone(payload.preset.extensions); }
  else { await write('characterExtension', { key: 'regex_scripts', value: raw }); (payload.card.extensions ??= {}).regex_scripts = raw; }
  publishRegex();
}

class Prompt { constructor(value) { Object.assign(this, value); } }
class Message {
  constructor(role, content, identifier) { Object.assign(this, { role, content, identifier }); }
}
class MessageCollection {
  constructor(identifier, ...items) { this.identifier = identifier; this.collection = items; }
  add(item) { this.collection.push(item); }
  flatten() { return this.collection.flatMap(message => message instanceof MessageCollection ? message.flatten() : [message]); }
  getChat() { return this.flatten().map(({ role, content, name }) => ({ role, content, ...(name ? { name } : {}) })); }
  getCollection() { return this.collection; }
  getItemByIdentifier(id) { return this.collection.find(message => message.identifier === id); }
  hasItemWithIdentifier(id) { return !!this.getItemByIdentifier(id); }
}
const promptManager = {
  messages: new MessageCollection('root'),
  getPromptCollection: () => ({ collection: currentPreset().prompts }),
  getActiveGroupCharacters: () => [],
  preparePrompt: prompt => new Prompt({ ...prompt, content: expandMacros(prompt.content ?? '', env()) }),
  setChatCompletion(completion) { this.messages = completion.messages; },
  render: () => renderPromptManager(),
};
window.__tavernModules = {
  promptManager, Message, MessageCollection, getPresetManager,
  displayVersion: 'dsh-tavern-mode 0.3.6', streamingProcessor: null,
  equalsIgnoreCaseAndAccents: (a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }) === 0,
  getSanitizedFilename: name => String(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_'),
  sendOpenAIRequest: async (type, messages) => ({ choices: [{ message: { role: 'assistant', content: await rpc('generate', { raw: true, messages }) } }] }),
};
function snapshotPreset() {
  const { preset_settings_openai, ...preset } = context.chatCompletionSettings;
  return preset;
}
function syncPreset(preset, name) {
  context.chatCompletionSettings ??= {};
  for (const key of Object.keys(context.chatCompletionSettings)) delete context.chatCompletionSettings[key];
  Object.assign(context.chatCompletionSettings, { prompts: [], prompt_order: [], extensions: {} }, clone(preset ?? {}), { preset_settings_openai: name });
  savedPreset = JSON.stringify(snapshotPreset());
  renderPromptManager();
}
let presetSaveQueued = false;
function renderPromptManager() {
  const host = document.getElementById('completion_prompt_manager');
  if (!host) return;
  host.hidden = true;
  const list = document.createElement('ul'); list.id = 'completion_prompt_manager_list';
  for (const prompt of toHelperPreset(snapshotPreset()).prompts) {
    const row = document.createElement('li'); row.dataset.pmIdentifier = prompt.id;
    row.className = 'completion_prompt_manager_prompt' + (prompt.enabled ? '' : ' completion_prompt_manager_prompt_disabled');
    const name = document.createElement('span'); name.dataset.pmName = prompt.name ?? ''; name.textContent = prompt.name ?? '';
    const toggle = document.createElement('button'); toggle.className = 'prompt-manager-toggle-action'; toggle.setAttribute('aria-pressed', String(prompt.enabled));
    toggle.onclick = () => {
      const preset = snapshotPreset(), helper = toHelperPreset(preset);
      const current = helper.prompts.find(item => item.id === prompt.id);
      if (!current) return;
      current.enabled = !current.enabled;
      const data = fromHelperPreset(helper, preset);
      Object.assign(context.chatCompletionSettings, data); payload.preset = clone(data);
      renderPromptManager();
      if (!presetSaveQueued) {
        presetSaveQueued = true;
        queueMicrotask(() => { presetSaveQueued = false; saveSettings().catch(report); });
      }
    };
    row.append(name, toggle); list.append(row);
  }
  const save = document.createElement('button'); save.id = 'update_oai_preset';
  save.onclick = () => replacePreset(payload.presetName, currentPreset()).catch(report);
  host.replaceChildren(list, save);
}
async function saveSettings() {
  publishRegex();
  await syncVariables();
  if (!payload.state.presetId || running) return;
  const preset = snapshotPreset(), serialized = JSON.stringify(preset);
  if (serialized === savedPreset) return;
  await write('preset', { id: payload.state.presetId, data: preset, inUse: true });
  savedPreset = serialized; payload.preset = clone(preset);
}

function primaryWorldbook() { return payload.card.character_book ? payload.card.extensions?.world || payload.card.character_book.name || payload.card.name : null; }
function rawWorldbook(name) {
  const book = name === primaryWorldbook() ? payload.card.character_book : payload.worldbooks.find(book => book.name === name || book.id === name)?.data;
  if (!book) throw new Error(`世界书未加载：${name}`);
  const entries = Array.isArray(book.entries) ? book.entries : Object.values(book.entries ?? {});
  const converted = officialHelper.fromCharacterBook({ entries: entries.map((entry, index) => ({ ...clone(entry), id: entry.uid ?? entry.id ?? index })) });
  return { ...clone(book), entries: Object.fromEntries(entries.map((entry, index) => {
    if (entry.uid !== undefined) return [entry.uid, { ...clone(officialHelper.newWorldInfoEntryTemplate), ...clone(entry) }];
    const id = entry.id ?? index;
    return [id, converted.entries[id]];
  })) };
}
function getWorldbook(name) { return officialHelper.api.getWorldbook(name); }
function replaceWorldbook(...args) { return officialHelper.api.replaceWorldbook(...args); }
async function saveWorldInfo(name, data) {
  rawWorldbook(name);
  const raw = clone(Object.values(data.entries));
  if (raw.some(entry => !Number.isSafeInteger(entry.uid) || typeof entry.content !== 'string') || new Set(raw.map(entry => entry.uid)).size !== raw.length) throw new Error('世界书条目无效或编号重复');
  const primary = name === primaryWorldbook();
  const key = primary ? payload.cardId : payload.worldbooks.find(book => book.name === name || book.id === name).id;
  if (running) (payload.state.worldbookOverrides ??= {})[key] = raw;
  else { await write('worldbook', { name, primary, entries: raw }); delete (payload.state.worldbookOverrides ?? {})[key]; }
  if (primary) payload.card.character_book.entries = raw;
  else payload.worldbooks.find(book => book.name === name || book.id === name).data.entries = raw;
  await eventEmit(event_types.WORLDINFO_UPDATED, name, rawWorldbook(name));
}
function getLorebookSettings() { return { selected_global_lorebooks: payload.worldbooks.map(book => book.name), scan_depth: 4, context_percentage: 100, budget_cap: 0, min_activations: 0, max_depth: 0, max_recursion_steps: 0, insertion_strategy: 'character_first', include_names: false, recursive: true, case_sensitive: false, match_whole_words: false, use_group_scoring: false, overflow_alert: false, ...payload.state.worldbookSettings }; }
function initializeGlobal(name, value) { _.set(window, name, value); eventEmit(`global_${name}_initialized`).catch(report); }
async function waitGlobalInitialized(name) {
  if (!_.has(window, name)) await new Promise(resolve => eventSource.once(`global_${name}_initialized`, resolve));
}
function replaceScriptButtons(id, values) {
  const record = scriptRecords.get(id);
  if (!record) throw new Error(`脚本不存在：${id}`);
  record.button = { enabled: true, buttons: clone(values) };
  for (const [key, element] of buttons) if (element.dataset.scriptId === id) { element.remove(); buttons.delete(key); }
  for (const button of values.filter(button => button.visible)) {
    const element = document.createElement('button'); element.textContent = button.name; element.dataset.scriptId = id;
    const key = `${id}:${button.name}`;
    element.onclick = () => eventEmit(`tavern-button:${key}`).catch(report);
    document.getElementById('script-buttons').append(element); buttons.set(key, element);
  }
  notify('buttons', { buttons: [...buttons].map(([id, element]) => ({ id, name: element.textContent })) });
}

const functions = {
  errorCatched: callback => function(...args) {
    try { const result = callback.apply(this, args); if (result?.catch) result.catch(report); return result; }
    catch (error) { report(error); throw error; }
  },
  getContext: () => context, eventOn, eventOnce: eventSource.once, eventEmit, eventRemoveListener: eventRemove,
  eventMakeFirst: eventSource.makeFirst, eventMakeLast: eventSource.makeLast,
  getCurrentChatId: () => payload.state.id, getCurrentCharId: () => payload.cardId, getCurrentCharName: () => payload.card.name,
  setUserName: async userName => {
    await write('userName', { userName });
    payload.state.userName = context.name1 = userName.trim();
  },
  getCurrentMessageId: () => context.chat.length - 1, getLastMessageId: () => context.chat.length - 1,
  getTavernVersion: () => '1.14.0', // Compatibility baseline for legacy lifecycle feature detection.
  initializeGlobal, waitGlobalInitialized,
  getChatMessages, setChatMessages, setChatMessage, createChatMessages, deleteChatMessages,
  getVariables: options => clone(scope(options)), replaceVariables, updateVariablesWith,
  insertOrAssignVariables: (value, options) => updateVariablesWith(previous => _.mergeWith(previous, value, (left, right) => Array.isArray(right) ? right : undefined), options),
  insertVariables: (value, options) => updateVariablesWith(previous => _.mergeWith({}, value, previous, (left, right) => Array.isArray(right) ? right : undefined), options),
  deleteVariable: (key, options) => { const delete_occurred = _.unset(scope(options), key); syncVariables().catch(report); return { variables: clone(scope(options)), delete_occurred }; },
  registerVariableSchema: (schema, options) => variableSchemas.set(options.type, schema),
  substituteParams: text => expandMacros(text, env()), substituteParamsExtended: text => expandMacros(text, env()), substitudeMacros: text => expandMacros(text, env()),
  getPreset: currentPreset, getPresetNames: () => payload.presets.map(p => p.name), getLoadedPresetName: () => payload.presetName ?? '', getLoadedName: () => payload.presetName ?? '',
  replacePreset, createOrReplacePreset, loadPreset,
  createPreset: async (name, preset) => name === 'in_use' || payload.presets.some(p => p.name === name) ? false : createOrReplacePreset(name, preset),
  updatePresetWith: async (name, update) => replacePreset(name, await update(currentPreset(name))),
  getPresetManager, getChatCompletionModel: () => payload.state.config.agents.write.model,
  setPromptEnabled: async (id, enabled) => { const preset = currentPreset(); const p = preset.prompts.find(p => p.id === id); if (!p) throw new Error('提示词不存在'); p.enabled = enabled; return replacePreset('in_use', preset); },
  getButtonEvent: label => `tavern-button:${label}`, getScriptId: () => 'tavern-mode',
  setSendingMessageText: setDraft, getSendingMessageText: () => document.getElementById('send_textarea').value, sendUserMessage: text => send(String(text ?? ''), 'normal'),
  triggerSlash: async value => (await executeSlashCommands(value)).pipe, triggerSlashWithResult: async value => (await executeSlashCommands(value)).pipe, executeSlashCommands, executeSlashCommandsWithOptions: executeSlashCommands,
  injectPrompts: (values, options = {}) => { for (const value of values) injections.set(value.id, { ...value, once: !!options.once }); return { uninject: () => { for (const value of values) injections.delete(value.id); } }; },
  uninjectPrompts: ids => { for (const id of ids) injections.delete(id); },
  setExtensionPrompt: (id, content, position, depth = 0, scan = false, role = 0) => injections.set(id, { id, content, position: Number(position) === 0 ? 'before_prompt' : 'in_chat', depth, role: ['system', 'user', 'assistant'][Number(role)] ?? role, should_scan: scan }),
  registerMacro: (name, callback) => { templateMacros.set(name, callback); return () => templateMacros.delete(name); }, unregisterMacro: name => templateMacros.delete(name),
  generate: options => rpc('generate', { ...options, raw: false }), generateRaw: options => rpc('generate', { ...options, raw: true }),
  getWorldbook: async name => getWorldbook(name), getWorldbookNames: () => [primaryWorldbook(), ...payload.worldbooks.map(b => b.name)].filter(Boolean),
  replaceWorldbook, updateWorldbookWith: (...args) => officialHelper.api.updateWorldbookWith(...args),
  createWorldbookEntries: (...args) => officialHelper.api.createWorldbookEntries(...args),
  getCharWorldbookNames: (name = 'current') => {
    if (name !== 'current' && name !== payload.card.name) throw new Error(`未找到名为 '${name}' 的角色卡`);
    return { primary: primaryWorldbook(), additional: [] };
  },
  getCharLorebooks: ({ name = 'current' } = {}) => functions.getCharWorldbookNames(name), getCurrentCharPrimaryLorebook: primaryWorldbook,
  getGlobalWorldbookNames: () => payload.worldbooks.map(book => book.name), getLorebookSettings,
  getLorebookEntries: (...args) => officialHelper.api.getLorebookEntries(...args),
  setLorebookSettings: settings => { payload.state.worldbookSettings = { ...getLorebookSettings(), ...clone(settings) }; if (!running) write('worldbookSettings', payload.state.worldbookSettings).catch(report); },
  loadWorldInfo: name => clone(rawWorldbook(name)), getCharacterCardFields: () => clone(payload.card), getCurrentLocale: () => 'zh-CN',
  getTavernRegexes, replaceTavernRegexes, updateTavernRegexesWith: async (update, options) => replaceTavernRegexes(await update(getTavernRegexes(options)), options), isCharacterTavernRegexesEnabled: () => true,
  formatAsTavernRegexedString: (text, source, destination, options = {}) => applyRegex(text, runtimeRegex(), { phase: destination, placement: regexSources[source], depth: options.depth, env: env() }),
  formatAsDisplayedMessage: text => displayText(text, context.chat.length - 1, 'assistant'),
  reloadCurrentChat: async () => { publishRegex(); if (!payload.native) await renderChat(); },
  saveChat: async () => { if (!running) await write('editChat', { chat: context.chat }); }, saveChatConditional: async () => functions.saveChat(),
  saveMetadata: syncVariables, saveSettingsDebounced: () => { storage.flush().catch(report); saveSettings().catch(report); }, saveSettings,
  Generate: type => send(undefined, type === 'continue' ? 'continue' : 'normal'),
  deactivateSendButtons: () => notify('composer', { disabled: true }), activateSendButtons: () => notify('composer', { disabled: false }),
};
Object.assign(context, functions);
Object.assign(window, functions, { SillyTavern: context, TavernHelper: functions, tavern_events: event_types, iframe_events: { GENERATION_STARTED: 'iframe_generation_started', GENERATION_ENDED: 'iframe_generation_ended', STREAM_TOKEN_RECEIVED_INCREMENTALLY: 'iframe_stream_token_received_incrementally' } });
window.AutoCardUpdaterAPI = {
  exportTableAsJson: async () => clone(payload.state.tables),
  registerTableUpdateCallback: callback => eventOn('table_updated', callback),
  unregisterTableUpdateCallback: callback => eventRemove('table_updated', callback),
};
window.toastr = Object.fromEntries(['info', 'success', 'warning', 'error'].map(level => [level, (message, title, options) => {
  if (title && typeof title === 'object') { options = title; title = ''; }
  notify('notice', { message: [title, message].filter(Boolean).map(String).join('：'), level, timeOut: options?.timeOut });
}]));
window.toastr.clear = window.toastr.remove = () => notify('notice', { message: '' });
context.toastr = window.toastr;
window.callGenericPopup = context.callGenericPopup = (content, type, input = '', options = {}) => new Promise(resolve => {
  const dialog = document.createElement('dialog'), body = document.createElement('div'), actions = document.createElement('div');
  dialog.style.cssText = 'max-width:min(900px,90vw);max-height:90vh;overflow:auto;background:#24262a;color:#eee;border:1px solid #777;border-radius:10px;padding:20px';
  if (typeof content === 'string') body.innerHTML = content;
  else if (content?.jquery) body.append(content[0]);
  else body.append(content);
  const field = document.createElement('input'); field.value = input; field.style.width = '100%';
  dialog.append(body); if (type === context.POPUP_TYPE.INPUT) dialog.append(field);
  const finish = result => { dialog.remove(); resolve(result); };
  for (const [name, value] of [...(options.customButtons ?? []).map((button, index) => [button.text, button.result ?? index + 2]), [options.okButton ?? '确定', 1], ...(type === context.POPUP_TYPE.TEXT ? [] : [[options.cancelButton ?? '取消', 0]])]) {
    const button = document.createElement('button'); button.textContent = name;
    button.onclick = () => finish(type === context.POPUP_TYPE.INPUT && value === 1 ? field.value : value); actions.append(button);
  }
  dialog.append(actions); dialog.addEventListener('cancel', () => finish(null)); document.body.append(dialog); dialog.showModal();
});
window.BubbleAvatar = {
  getAvatar: async (name, charId = payload.cardId) => { const record = await bubbleRecord('avatars', avatarAlias(name)); if (!record?.imageBlob) return record?.sourceUrl ?? null; const url = URL.createObjectURL(record.imageBlob); urls.add(url); return url; },
  getMoodAvatar: async (name, mood, charId = payload.cardId) => { const record = await bubbleRecord('mood_avatars', `${avatarAlias(name)}__${mood}`); if (!record?.imageBlob) return record?.sourceUrl ?? null; const url = URL.createObjectURL(record.imageBlob); urls.add(url); return url; },
  getColor: async (name, charId = payload.cardId) => (await bubbleRecord('config', `color_${avatarAlias(name)}`))?.value,
};

function syncPayload(next) {
  next = { ...next, preset: next.state.presetOverride ?? next.preset };
  const previous = payload;
  payload = next;
  window.__dshCardId = next.cardId;
  const messages = next.state.messages.map((m, i) => {
    const alternatives = m.greeting ? [next.card.first_mes, ...(next.card.alternate_greetings ?? [])] : [m.content];
    const message = { ...m.extra, name: m.name, is_user: m.role === 'user', is_system: m.is_hidden ?? false, mes: m.content, send_date: m.createdAt, swipes: alternatives, swipe_id: Math.max(0, alternatives.indexOf(m.content)), extra: { ...(m.role === 'system' ? { type: 'narrator' } : {}), ...m.extra }, ...(next.state.helperChat ?? []).find(message => message.tavernMessageId === m.id), tavernMessageId: m.id, message_id: i };
    if (next.state.messageVariables?.[i]) message.variables = Array.isArray(next.state.messageVariables[i]) ? next.state.messageVariables[i] : [next.state.messageVariables[i]];
    return message;
  });
  context.chat.splice(0, context.chat.length, ...messages);
  context.chat_metadata = { ...next.state.chatMetadata, variables: next.state.variables ?? {} };
  for (const key of Object.keys(context.extension_settings)) delete context.extension_settings[key];
  Object.assign(context.extension_settings, { regex: next.globalRegex ?? [], character_allowed_regex: [next.cardId], ...next.state.extensionSettings, variables: { global: next.state.globalVariables ?? {} } });
  for (const key of Object.keys(context.power_user)) delete context.power_user[key];
  Object.assign(context.power_user, clone(context.extension_settings.__tavern_power_user ?? {}));
  context.power_user.reasoning ??= { auto_parse: false, prefix: '<think>', suffix: '</think>', separator: '' };
  context.characters ??= [];
  context.characters.splice(0, context.characters.length, { ...next.card, data: next.card, avatar: next.cardId });
  context.characters[next.cardId] = context.characters[0];
  context.characterId = context.this_chid = next.cardId;
  syncPreset(next.preset, next.presetName);
  context.name1 = next.state.userName; context.name2 = next.card.name;
  context.chatId = next.state.id;
  window.characters = context.characters; window.this_chid = next.cardId;
  if (previous && previous.state.revision !== next.state.revision) eventEmit('table_updated').catch(report);
}

const childBridge = (index, scriptId = null) => `<script>
(()=>{const p=parent;const offs=[];
for(const key of ${JSON.stringify(Object.keys(functions))}) if(p[key]) window[key]=p[key];
for(const key of ['SillyTavern','TavernHelper','tavern_events','iframe_events','_','lodash','toastr','BubbleAvatar','BubbleCG','avatarDB','indexedDB','IDBKeyRange']) if(p[key]) Object.defineProperty(window,key,{configurable:true,writable:true,value:p[key]});
p.__tavernApplyTheme?.(document);
Object.defineProperty(window,'localStorage',{value:p.localStorage});Object.defineProperty(window,'sessionStorage',{value:p.sessionStorage});
window.$=window.jQuery=function(value,ctx){if(typeof value==='function'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',value,{once:true});else queueMicrotask(value);return;}return p.jQuery(value,ctx||document);};Object.assign(window.$,p.jQuery);window.$.fn=p.jQuery.fn;
window.getCurrentMessageId=()=>${index};
window.eventOn=(...args)=>{const off=p.eventOn(...args);offs.push(off);return off;};
window.AutoCardUpdaterAPI={...p.AutoCardUpdaterAPI,registerTableUpdateCallback:cb=>{const off=p.AutoCardUpdaterAPI.registerTableUpdateCallback(cb);offs.push(off);return off;}};
window.addEventListener('pagehide',()=>offs.forEach(off=>off()));
window.addEventListener('error',e=>p.__reportTavernError(e.error||e.message));
window.addEventListener('unhandledrejection',e=>p.__reportTavernError(e.reason));
let resizePending=false;
const resize=()=>{if(resizePending)return;resizePending=true;queueMicrotask(()=>{resizePending=false;if(frameElement){const height=Math.max(30,document.body?.scrollHeight||0)+'px';if(frameElement.style.height!==height)frameElement.style.height=height;p.__tavernResize?.();}});};
window.addEventListener('resize',resize);
window.addEventListener('DOMContentLoaded',()=>{new ResizeObserver(resize).observe(document.body);resize();});
p.__tavernBind(window,${index},${JSON.stringify(scriptId)});
})();<\/script>`;
window.__reportTavernError = report;
window.__tavernBind = (target, index, scriptId = null) => {
  Object.assign(target, { __VUE_PROD_DEVTOOLS__: true, __VUE_OPTIONS_API__: true, __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false });
  target.__tavernHost = window;
  target.fetch = (input, options) => frontendFetch(input, options, target.document.baseURI);
  for (const key of ['z', 'YAML', 'Vue', 'VueRouter']) target[key] = window[key];
  target.__tavernBind = window.__tavernBind;
  const stops = [];
  for (const [name, method] of Object.entries({ eventOn, eventOnce: eventSource.once, eventMakeFirst: eventSource.makeFirst, eventMakeLast: eventSource.makeLast })) target[name] = (...args) => { const stop = method(...args); stops.push(stop); return stop; };
  target.eventClearAll = () => { for (const stop of stops.splice(0)) stop(); };
  target.addEventListener('pagehide', target.eventClearAll, { once: true });
  const expose = name => { if (_.has(window, name)) Object.defineProperty(target, name, { get: () => _.get(window, name), configurable: true }); };
  target.waitGlobalInitialized = async name => { await waitGlobalInitialized(name); expose(name); };
  expose('Mvu');
  target.getAllVariables = () => Object.assign({}, functions.getVariables({ type: 'global' }), functions.getVariables({ type: 'character' }), scriptId ? functions.getVariables({ type: 'script', script_id: scriptId }) : {}, functions.getVariables(), ...context.chat.slice(0, index < 0 ? undefined : index + 1).map(message => message.variables?.[message.swipe_id ?? 0]));
  if (scriptId) {
    target.getScriptId = () => scriptId;
    target.getScriptName = () => scriptRecords.get(scriptId)?.name ?? '';
    target.getScriptInfo = () => scriptRecords.get(scriptId)?.info ?? '';
    target.getCurrentMessageId = () => { throw new Error('脚本没有固定消息楼层，请使用 getLastMessageId()'); };
    target.getScriptButtons = () => clone(scriptRecords.get(scriptId)?.button?.buttons ?? []);
    target.replaceScriptButtons = values => replaceScriptButtons(scriptId, values);
    target.updateScriptButtonsWith = update => { const result = update(target.getScriptButtons()); return result?.then ? result.then(value => { target.replaceScriptButtons(value); return value; }) : (target.replaceScriptButtons(result), result); };
    target.appendInexistentScriptButtons = values => target.updateScriptButtonsWith(previous => [...previous, ...values.filter(value => !previous.some(button => button.name === value.name))]);
    target.getButtonEvent = name => `tavern-button:${scriptId}:${name}`;
    for (const name of ['getVariables', 'replaceVariables', 'updateVariablesWith', 'insertVariables', 'insertOrAssignVariables', 'deleteVariable']) target[name] = (...args) => {
      const optionIndex = name === 'getVariables' ? 0 : 1;
      if (args[optionIndex]?.type === 'script') args[optionIndex] = { ...args[optionIndex], script_id: scriptId };
      return functions[name](...args);
    };
    target.$ = target.jQuery = (value, scope) => {
      if (typeof value !== 'function') return $(value, scope);
      trackReady(Promise.resolve().then(() => value(target.$)));
      return $(document);
    };
    Object.assign(target.$, $); target.$.fn = $.fn;
  }
  target.TavernHelper = { ...functions, ...Object.fromEntries(Object.keys(functions).filter(key => typeof target[key] === 'function').map(key => [key, target[key]])) };
  if (officialHelper) {
    target.__TH_IFRAME_ID = scriptId ? `TH-script--${window.__tavernHubId}--${scriptId}` : `TH-message--${Math.max(0, index)}--${componentWindows.size}`;
    target.__tavernScriptId = scriptId;
    const bound = officialHelper.bind(target);
    target._th_impl = { _log: (_name, _level, message) => report(message) };
    target.addEventListener('pagehide', () => target.eventClearAll(), { once: true });
    Object.assign(target.TavernHelper, bound);
  }
};
function themeScheme(theme = {}) {
  if (theme.scheme === 'light' || theme.scheme === 'dark') return theme.scheme;
  const m = String(theme.color ?? '').match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return 'dark';
  return (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) > 140 ? 'dark' : 'light';
}
function componentHead(index, scriptId) {
  const theme = payload.theme ?? {}, scheme = themeScheme(theme);
  const color = theme.color ?? (scheme === 'dark' ? '#e5e8ef' : '#111');
  const background = theme.background ?? (scheme === 'dark' ? '#151517' : '#fff');
  const font = theme.fontFamily ?? 'system-ui';
  return `<meta charset="utf-8"><meta name="color-scheme" content="only ${scheme}"><style>html{color-scheme:only ${scheme};background:${background}!important}html,body{margin:0;min-height:0;overflow:hidden;background:${background}!important;color:${color}!important;font-family:${font}}.dc-root,.dc-narration-block,.dc-msg-text,.dc-msg-name,.dc-cn{color:inherit!important}</style>${childBridge(index, scriptId)}`;
}
window.__tavernApplyTheme = document => {
  const theme = payload.theme ?? {}, scheme = themeScheme(theme), dark = scheme === 'dark';
  const color = theme.color ?? (dark ? '#ddd' : '#111'), background = theme.background ?? (dark ? '#151517' : '#fff'), bubble = theme.bubble ?? background;
  for (const [key, value] of Object.entries({ color, bubble, font: theme.fontFamily ?? 'system-ui' })) document.documentElement.style.setProperty('--tavern-' + key, value);
  document.documentElement.style.colorScheme = 'only ' + scheme;
  document.documentElement.style.background = background;
  let meta = document.head.querySelector('meta[name="color-scheme"]');
  if (!meta) { meta = document.createElement('meta'); meta.name = 'color-scheme'; document.head.prepend(meta); }
  meta.content = 'only ' + scheme;
  const variables = { SmartThemeBodyColor: color, SmartThemeEmColor: dark ? 'rgb(145,145,145)' : 'rgb(90,90,90)', SmartThemeQuoteColor: 'rgb(225,138,36)', SmartThemeUnderlineColor: dark ? 'rgb(188,231,207)' : 'rgb(40,110,80)', SmartThemeBorderColor: dark ? 'rgb(0 0 0 / 50%)' : 'rgb(0 0 0 / 16%)', SmartThemeBlurTintColor: dark ? 'rgb(23,23,23)' : 'rgb(250,250,250)', SmartThemeChatTintColor: dark ? 'rgb(23,23,23)' : 'rgb(250,250,250)', mainFontFamily: theme.fontFamily ?? 'system-ui', mainFontSize: '14px', 'animation-duration-2x': '200ms' };
  for (const shade of ['black', 'white']) for (let alpha = 0; alpha <= 100; alpha += 10) variables[shade + alpha + (alpha === 100 ? '' : 'a')] = `rgb(${shade === 'black' ? '0 0 0' : '255 255 255'} / ${alpha}%)`;
  for (const [name, value] of Object.entries(variables)) document.documentElement.style.setProperty('--' + name, value);
  if (document.body) { document.body.style.background = background; document.body.style.color = color; }
  if (!document.head.querySelector(':scope > #tavern-theme-compat')) {
    const style = document.createElement('style'); style.id = 'tavern-theme-compat';
    style.textContent = '.menu_button{color:var(--SmartThemeBodyColor);background:var(--SmartThemeBlurTintColor);border:1px solid var(--SmartThemeBorderColor);border-radius:5px;padding:3px 5px;cursor:pointer;margin:5px 0;display:flex;align-items:center;justify-content:center;text-align:center}.text_pole{background:var(--black30a);color:var(--SmartThemeBodyColor);border:1px solid var(--SmartThemeBorderColor);border-radius:5px;font-family:var(--mainFontFamily);padding:3px 5px;width:100%;margin:5px 0;box-sizing:border-box}';
    const fonts = document.createElement('link'); fonts.rel = 'stylesheet'; fonts.href = location.origin + '/fontawesome.css';
    document.head.append(style, fonts);
  }
  if (theme.viewportHeight > 0 && viewportSizes.get(document) !== theme.viewportHeight) {
    viewportSizes.set(document, theme.viewportHeight);
    document.documentElement.style.setProperty('--TH-viewport-height', theme.viewportHeight + 'px');
    const frame = document.defaultView?.frameElement;
    if (frame && !frame.id.startsWith('TH-script-')) frame.style.height = theme.viewportHeight + 'px';
  }
};
window.__tavernExpose = (target, index) => {
  componentWindows.add(target); target.addEventListener('pagehide', () => componentWindows.delete(target), { once: true });
  Object.assign(target, functions);
  for (const key of ['SillyTavern', 'TavernHelper', 'tavern_events', 'iframe_events', '_', 'lodash', 'toastr', 'BubbleAvatar', 'BubbleCG', 'avatarDB', 'AutoCardUpdaterAPI', '__reportTavernError']) if (window[key]) target[key] = window[key];
  for (const key of ['indexedDB', 'IDBKeyRange', 'localStorage', 'sessionStorage']) Object.defineProperty(target, key, { configurable: true, value: window[key] });
  target.$ = target.jQuery = function(value, scope) { if (typeof value === 'function') { if (target.document.readyState === 'loading') target.document.addEventListener('DOMContentLoaded', value, { once: true }); else queueMicrotask(value); return; } return $(value, scope || target.document); };
  Object.assign(target.$, $); target.$.fn = $.fn;
  target.getCurrentMessageId = () => index;
  target.__tavernApplyTheme = window.__tavernApplyTheme;
  window.__tavernBind(target, index);
};
window.__tavernComponentHtml = (body, index) => {
  const prefix = componentHead(index);
  return /<head(?:\s[^>]*)?>/i.test(body) ? body.replace(/<head(?:\s[^>]*)?>/i, value => value + prefix) : prefix + body;
};
window.__tavernPrepareHtml = prepareFrontendHtml;

function displayText(text, index, role) {
  return applyRegex(text, withoutLegacyBubble(payload.regex), { phase: 'display', depth: payload.state.messages.length - index - 1, placement: role === 'user' ? 1 : 2, env: env() });
}
async function renderMarkdown(parent, text) {
  const content = document.createElement('div');
  content.className = 'markdown';
  content.innerHTML = DOMPurify.sanitize(marked.parse(text));
  parent.append(content);
}
async function renderContent(target, text, index) {
  for (const part of displaySegments(text, payload.state.messages[index]?.role !== 'user', { cardId: payload.cardId, userName: payload.state.userName })) {
    if (part.html !== undefined) {
      const frame = document.createElement('iframe');
      frame.className = 'tm-component'; frame.title = '角色卡前端组件'; frame.scrolling = 'no';
      const body = await prepareFrontendHtml(part.html);
      const prefix = componentHead(index);
      frame.srcdoc = /<head(?:\s[^>]*)?>/i.test(body) ? body.replace(/<head(?:\s[^>]*)?>/i, value => value + prefix) : prefix + body;
      target.append(frame);
    } else await renderMarkdown(target, part.text);
  }
}

async function renderChat() {
  const chat = document.getElementById('chat');
  const keepBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 150;
  const ids = new Set();
  for (let index = 0; index < payload.state.messages.length; index++) {
    const message = payload.state.messages[index]; ids.add(message.id);
    let row = [...chat.children].find(row => row.dataset.id === message.id);
    const mode = payload.state.renderMode ?? 'card';
    const raw = context.chat[index]?.mes ?? message.content;
    const display = mode === 'card' ? displayText(raw, index, message.role) : raw;
    if (row?.__rendered === display && row?.__mode === mode) continue;
    if (!row) { row = document.createElement('article'); row.className = 'mes'; row.dataset.id = message.id; chat.append(row); }
    row.setAttribute('mesid', String(index)); row.setAttribute('is_user', String(message.role === 'user')); row.dataset.role = message.role;
    row.innerHTML = `<header><span>${html(message.name || (message.role === 'user' ? payload.state.userName : payload.card.name))}</span><small>${index + 1}</small></header><div class="mes_text"></div>`;
    const target = row.querySelector('.mes_text');
    if (mode === 'text') { target.style.whiteSpace = 'pre-wrap'; target.textContent = display; }
    else await renderContent(target, display, index);
    row.__rendered = display; row.__mode = mode;
    await eventEmit(message.role === 'user' ? event_types.USER_MESSAGE_RENDERED : event_types.CHARACTER_MESSAGE_RENDERED, index);
  }
  for (const row of [...chat.children]) if (!ids.has(row.dataset.id)) row.remove();
  if (keepBottom) chat.scrollTop = chat.scrollHeight;
}

function flattenScripts(entries, inherited = true) {
  return (entries ?? []).flatMap(entry => entry.type === 'folder' ? flattenScripts(entry.scripts ?? entry.value, inherited && entry.enabled !== false) : inherited && entry.enabled !== false && typeof entry.content === 'string' ? [entry] : []);
}
async function loadScripts() {
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) for (const element of mutation.addedNodes) if (element.nodeType === 1) {
      const scripts = [...(element.matches('script') ? [element] : []), ...element.querySelectorAll('script')];
      for (const script of scripts) if (script.src) trackReady(new Promise((resolve, reject) => {
        script.addEventListener('load', resolve, { once: true }); script.addEventListener('error', () => reject(new Error(`依赖加载失败：${script.src || '内联模块'}`)), { once: true });
      }), script.src || script.id || '内联模块');
    }
  });
  observer.observe(document, { childList: true, subtree: true });
  const extras = withoutLegacyBubble([...flattenScripts(payload.card.extensions?.tavern_helper?.scripts), ...flattenScripts(payload.preset?.extensions?.tavern_helper?.scripts)]).filter(script => script.id !== builtinBubbleScript.id);
  const scripts = [builtinBubbleScript, ...extras];
  const host = document.getElementById('tavern_helper');
  for (const script of scripts) {
    scriptRecords.set(script.id, clone(script));
    (payload.state.scriptVariables ??= {})[script.id] ??= clone(script.data ?? {});
    const marker = document.createElement('div'); marker.dataset.scriptId = script.id; host.append(marker);
  }
  for (const script of scripts) {
    try {
      const frame = document.createElement('iframe');
      frame.title = script.name; frame.id = `TH-script--${window.__tavernHubId}--${script.id}`;
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;border:0';
      const loaded = new Promise(resolve => { frame.onload = resolve; });
      frame.srcdoc = '<!doctype html><html><head>' + childBridge(-1, script.id) + '</head><body></body></html>';
      document.body.append(frame); await loaded;
      scriptWindows.set(script.id, frame.contentWindow);
      replaceScriptButtons(script.id, script.button?.buttons ?? []);
      const source = script.content.match(/^\s*```[^\n]*\n([\s\S]*)\n```\s*$/)?.[1] ?? script.content;
      const [code] = await compileFrontend([source]);
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })); urls.add(url);
      const module = frame.contentDocument.createElement('script'); module.type = 'module'; module.src = url;
      await new Promise((resolve, reject) => { module.onload = resolve; module.onerror = () => reject(new Error('模块或依赖加载失败')); frame.contentDocument.body.append(module); });
    } catch (error) { report(new Error(`脚本 ${script.name}：${error.message}`)); }
  }
  await Promise.resolve();
  while (readyTasks.size) { await Promise.allSettled([...readyTasks]); await Promise.resolve(); }
  observer.disconnect();
  await eventEmit(event_types.APP_READY);
  await eventEmit(event_types.CHAT_CHANGED, payload.state.id);
}

async function loadOfficialHelper() {
  const aliases = { temp_openai: 'temperature', freq_pen_openai: 'frequency_penalty', pres_pen_openai: 'presence_penalty', top_p_openai: 'top_p', repetition_penalty_openai: 'repetition_penalty', min_p_openai: 'min_p', top_k_openai: 'top_k', top_a_openai: 'top_a' };
  context.version = functions.getTavernVersion();
  context.extension_settings.character_allowed_regex ??= [payload.cardId];
  const presetList = payload.presets.map(item => item.data), presetNames = Object.fromEntries(payload.presets.map((item, index) => [item.name, index]));
  const getPreset = name => presetList[presetNames[name]];
  window.__tavernHelperHost = {
    context, report, saveSettings, substituteParams: functions.substituteParams, promptManager: { ...promptManager, renderDebounced: promptManager.render },
    oaiSettings: new Proxy(context.chatCompletionSettings, { get: (value, key) => value[aliases[key] ?? key], set: (value, key, data) => { value[aliases[key] ?? key] = data; return true; } }),
    getPreset,
    getWorldbookNames: functions.getWorldbookNames, selectedWorldbooks: functions.getGlobalWorldbookNames(),
    getCharLorebooks: functions.getCharLorebooks, loadWorldInfo: async name => rawWorldbook(name), saveWorldInfo,
    presetManager: {
      getAllPresets: () => Object.keys(presetNames), getSelectedPresetName: () => payload.presetName,
      getPresetList: () => ({ presets: presetList, preset_names: presetNames }),
      findPreset: name => Object.hasOwn(presetNames, name) ? String(presetNames[name]) : undefined,
      selectPreset: index => loadPreset(Object.keys(presetNames).find(name => presetNames[name] === Number(index))), select: $('<select>'),
      async savePreset(name, data) {
        const previous = payload.presets.find(item => item.name === name);
        if (previous) { await write('preset', { id: previous.id, data }); previous.data = clone(data); }
        else payload.presets.push(await write('createPreset', { name, data }));
        presetNames[name] ??= presetList.length; presetList[presetNames[name]] = data;
      },
      async deletePreset(name) { await write('deletePreset', { name }); delete presetNames[name]; payload.presets = payload.presets.filter(item => item.name !== name); return true; },
    },
    regex: (text, placement, options) => applyRegex(text, runtimeRegex(), { phase: options?.isPrompt ? 'prompt' : 'display', placement, depth: options?.depth, env: env() }),
    async writeExtensionField(_id, key, value) {
      if (key !== 'regex_scripts') throw new Error(`未连接角色字段 ${key}`);
      payload.card.extensions ??= {}; payload.card.extensions[key] = value;
      await write('characterExtension', { key, value }); publishRegex();
    },
    refreshOneMessage: async index => { publishRegex(); await eventEmit(context.chat[index]?.is_user ? event_types.USER_MESSAGE_RENDERED : event_types.CHARACTER_MESSAGE_RENDERED, index); },
    getButtonEvent: (target, name) => `tavern-button:${target.__tavernScriptId}:${name}`,
    update: () => rpc('helperUpdate', {}),
  };
  officialHelper = await import('/tavern-helper.js');
  Object.assign(event_types, officialHelper.tavern_events);
  Object.assign(functions, officialHelper.api);
  Object.assign(context, officialHelper.api);
  Object.assign(window, functions, { tavern_events: event_types, iframe_events: officialHelper.iframe_events });
  window.__TH_IFRAME_ID = 'TH-script--host--tavern-mode';
  window._th_impl = { _log: (_name, _level, message) => report(message) };
  Object.assign(functions, officialHelper.bind(window));
}

async function dispatch(method, args) {
  if (method === 'theme') {
    payload.theme = args; window.__tavernApplyTheme(document);
    for (const document of [window.document, ...[...componentWindows].map(target => target.document)]) { window.__tavernApplyTheme(document); for (const frame of document.querySelectorAll('iframe')) if (frame.contentDocument) window.__tavernApplyTheme(frame.contentDocument); }
    return true;
  }
  if (method === 'sync') { syncPayload(args); if (!payload.native) { rendering = rendering.then(renderChat); await rendering; } return true; }
  if (method === 'draft') { document.getElementById('send_textarea').value = args.text; return true; }
  if (method === 'prepare') {
    running = true;
    processedMessageId = undefined;
    const draft = { name: payload.state.userName, is_user: true, mes: args.text, extra: {} };
    if (args.trigger !== 'continue') context.chat.push(draft);
    await eventEmit(event_types.GENERATION_STARTED, args.trigger, {}, false);
    if (args.trigger !== 'continue') await eventEmit(event_types.MESSAGE_SENT, context.chat.length - 1);
    await eventEmit(event_types.GENERATION_AFTER_COMMANDS, args.trigger, {}, false);
    await Promise.all([...pendingWrites]);
    const enabledInjections = [];
    for (const { filter, once, ...value } of injections.values()) {
      if (!filter || await filter()) enabledInjections.push(value);
      if (once) injections.delete(value.id);
    }
    return { ...clone(generationSnapshot()), chat: clone(context.chat), injections: clone(enabledInjections) };
  }
  if (method === 'worldbookScan') {
    const activated = await activateWorldbookWithEvents(args.entries, args.options, eventEmit);
    return { ...activated, ...clone(variableSnapshot()) };
  }
  if (method === 'promptReady') {
    running = true;
    context.chat_metadata.variables = clone(args.variables ?? context.chat_metadata.variables);
    payload.state.globalVariables = clone(args.globalVariables ?? payload.state.globalVariables ?? {});
    if (args.entries.length) await eventEmit(event_types.WORLD_INFO_ACTIVATED, args.entries.map(toWorldInfoEntry));
    const data = { messages: args.messages, prompt: args.messages };
    promptManager.setChatCompletion({ messages: new MessageCollection('root', ...args.messages.map((message, index) => new Message(message.role, message.content, `message:${index}`))) });
    await eventEmit(event_types.GENERATE_AFTER_DATA, data, false);
    await eventEmit(event_types.CHAT_COMPLETION_SETTINGS_READY, data);
    const prompt = { chat: data.messages, dryRun: false };
    await eventEmit(event_types.CHAT_COMPLETION_PROMPT_READY, prompt);
    return { ...clone(generationSnapshot()), messages: prompt.chat, chat: clone(context.chat) };
  }
  if (method === 'messageReceived') {
    running = true;
    const { message, ...state } = args;
    syncPayload({ ...payload, state: { ...payload.state, ...state } });
    const current = context.chat.at(-1), format = context.power_user.reasoning;
    const prefix = String(format.prefix ?? '').replace(/^[\r\n]+|[\r\n]+$/g, ''), suffix = String(format.suffix ?? '').replace(/^[\r\n]+|[\r\n]+$/g, '');
    if (format.auto_parse && prefix && suffix) {
      const start = current.mes.indexOf(prefix), end = start < 0 ? -1 : current.mes.indexOf(suffix, start + prefix.length);
      if (end >= 0) {
        const reasoning = current.mes.slice(start + prefix.length, end).trim();
        current.extra.reasoning = [current.extra.reasoning, reasoning].filter(Boolean).join(format.separator || '\n');
        current.mes = (current.mes.slice(0, start) + current.mes.slice(end + suffix.length)).trim();
      }
    }
    await eventEmit(event_types.MESSAGE_RECEIVED, context.chat.length - 1);
    processedMessageId = message.id;
    return { ...clone(generationSnapshot()), message: context.chat.at(-1).mes, chat: clone(context.chat) };
  }
  if (method === 'finished') {
    running = false;
    await eventEmit(args.cancelled ? event_types.GENERATION_STOPPED : event_types.GENERATION_ENDED, context.chat.length - 1);
    if (!args.cancelled && processedMessageId !== context.chat.at(-1)?.tavernMessageId) await eventEmit(event_types.MESSAGE_RECEIVED, context.chat.length - 1);
    processedMessageId = undefined;
    if (deferredDeletes.size) {
      const indices = context.chat.flatMap((message, index) => deferredDeletes.has(message.tavernMessageId) ? [index] : []);
      await deleteChatMessages(indices); deferredDeletes.clear();
    }
    return true;
  }
  if (method === 'flush') { await storage.flush(); return true; }
  if (method === 'snapshot') { await storage.flush(); return { ...clone(generationSnapshot()), chat: clone(context.chat) }; }
  if (method === 'button') { document.getElementById('tavern-script-settings').hidden = true; await eventEmit(`tavern-button:${args.name}`); return true; }
  if (method === 'settings') { document.getElementById('tavern-script-settings').hidden = !args.open; return true; }
  throw new Error(`未知前端操作 ${method}`);
}

window.addEventListener('error', event => report(event.error ?? event.message));
window.addEventListener('unhandledrejection', event => report(event.reason));
window.addEventListener('message', async event => {
  if (event.source !== parent || event.data?.type !== 'tavern-init' || initialized || !event.ports[0]) return;
  initialized = true; running = !!event.data.payload.generating; port = event.ports[0]; window.__tavernHubId = event.data.hubId; syncPayload(event.data.payload);
  port.onmessage = async event => {
    const data = event.data;
    if (data.type === 'rpc-result') {
      const request = pending.get(data.id); if (!request) return;
      pending.delete(data.id); clearTimeout(request.timer); data.error ? request.reject(new Error(data.error)) : request.resolve(data.value);
    } else if (data.type === 'call') {
      try { notify('result', { id: data.id, value: await dispatch(data.method, data.args) }); }
      catch (error) { notify('result', { id: data.id, error: error.message }); }
    }
  };
  try {
    window.__tavernApplyTheme(document);
    installUiSurface();
    storage = await installStorage(payload.runtimeStorage, value => write('storage', value), { loadAsset: id => rpc('asset', { id }), saveAsset: (bytes, mime) => rpc('putAsset', { bytes, mime }) });
    await loadOfficialHelper();
    await loadScripts();
    publishRegex();
    if (!payload.native) await renderChat();
    document.getElementById('send_but').onclick = () => send();
    notify('ready', { scripts: runtimeErrors.length === 0, errors: runtimeErrors, buttons: [...buttons].map(([id, element]) => ({ id, name: element.textContent })) });
  } catch (error) { report(error); notify('ready', { scripts: false }); }
});
