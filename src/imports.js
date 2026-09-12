import { readFile, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { unzipSync } from 'fflate';

const MAX_BYTES = 128 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });
const hash = value => createHash('sha256').update(value).digest('hex');

function json(bytes) { return JSON.parse(decoder.decode(bytes).replace(/^\uFEFF/, '')); }
function zipName(name) {
  // Some exporters write UTF-8 names without ZIP's UTF-8 flag.
  if ([...name].every(c => c.charCodeAt(0) <= 255)) {
    try { name = decoder.decode(Buffer.from(name, 'latin1')); } catch { /* A legacy single-byte filename. */ }
  }
  name = name.replaceAll('\\', '/');
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..')) throw new Error('压缩包含越界路径');
  return name;
}

export function unzip(bytes) {
  let total = 0;
  const entries = unzipSync(bytes, { filter(entry) {
    total += entry.originalSize;
    if (entry.originalSize > MAX_BYTES || total > MAX_BYTES * 2) throw new Error('压缩包解压大小超过限制');
    zipName(entry.name);
    return true;
  } });
  const result = new Map();
  for (const [key, value] of Object.entries(entries)) {
    const name = zipName(key);
    if (result.has(name)) throw new Error(`压缩包有重复文件名：${name}`);
    result.set(name, value);
  }
  return result;
}

export function parseCardPng(bytes) {
  const buffer = Buffer.from(bytes);
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('PNG 文件头无效');
  const payloads = {};
  let ended = false;
  for (let offset = 8; offset < buffer.length;) {
    if (offset + 12 > buffer.length) throw new Error('PNG 数据不完整');
    const size = buffer.readUInt32BE(offset);
    if (size > MAX_BYTES || offset + size + 12 > buffer.length) throw new Error('PNG 数据块不完整');
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + size);
    offset += size + 12;
    if (type === 'IEND') { ended = true; break; }
    if (!['tEXt', 'zTXt', 'iTXt'].includes(type)) continue;
    const nul = data.indexOf(0);
    if (nul < 0) continue;
    const keyword = data.toString('ascii', 0, nul);
    if (!['chara', 'ccv3'].includes(keyword)) continue;
    let raw;
    if (type === 'tEXt') raw = data.subarray(nul + 1);
    if (type === 'zTXt') {
      if (data[nul + 1] !== 0) throw new Error('不支持的 PNG 压缩格式');
      raw = inflateSync(data.subarray(nul + 2), { maxOutputLength: MAX_BYTES });
    }
    if (type === 'iTXt') {
      const langEnd = data.indexOf(0, nul + 3);
      const translatedEnd = data.indexOf(0, langEnd + 1);
      if (langEnd < 0 || translatedEnd < 0) throw new Error('PNG 国际文本数据无效');
      raw = data.subarray(translatedEnd + 1);
      if (data[nul + 1] === 1) raw = inflateSync(raw, { maxOutputLength: MAX_BYTES });
    }
    if (payloads[keyword]) throw new Error(`PNG 有重复的 ${keyword} 角色数据`);
    const text = decoder.decode(raw).trim();
    payloads[keyword] = text.startsWith('{') ? JSON.parse(text) : json(Buffer.from(text, 'base64'));
  }
  if (!ended) throw new Error('PNG 缺少结束数据块');
  const card = payloads.ccv3 ?? payloads.chara;
  if (!card) throw new Error('PNG 中没有酒馆角色卡数据');
  validateCard(card);
  return card;
}

export function validateCard(value) {
  const card = value?.data ?? value;
  if (!card || typeof card.name !== 'string' || !card.name.trim()) throw new Error('角色卡缺少名称');
  for (const key of ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt', 'post_history_instructions']) {
    if (card[key] !== undefined && typeof card[key] !== 'string') throw new Error(`角色卡字段 ${key} 应为文本`);
  }
  if (card.extensions?.regex_scripts && !Array.isArray(card.extensions.regex_scripts)) throw new Error('角色正则列表无效');
  return card;
}

const isAdvanceProfile = value => value && !Array.isArray(value) && (Array.isArray(value.promptGroup) || Array.isArray(value.plotTasks) || value.plotSettings);

export function identifyJson(value) {
  if (value?.spec?.startsWith('chara_card_') || (typeof value?.name === 'string' && typeof value?.description === 'string')) { validateCard(value); return 'card'; }
  if (Array.isArray(value?.prompts) && (Array.isArray(value?.prompt_order) || value.settings)) return 'preset';
  if (value?.mate?.type === 'chatSheets' || Object.keys(value ?? {}).some(key => key.startsWith('sheet_'))) return 'tables';
  if (value?.type === 'bubble-character' || (Array.isArray(value?.avatars) && Array.isArray(value?.moodAvatars))) return 'bubble';
  if (isAdvanceProfile(value) || value?.charCardPrompt || value?.promptPresets) return 'advance';
  if (Array.isArray(value) && value.length && value.every(isAdvanceProfile)) return 'advance';
  if (Array.isArray(value?.entries) || (value?.entries && typeof value.entries === 'object')) return 'worldbook';
  if (Array.isArray(value) && value.every(x => x && typeof x.content === 'string')) return 'advance';
  if (typeof value?.findRegex === 'string') return 'regex';
  if (Array.isArray(value) && value.every(x => typeof x.findRegex === 'string')) return 'regex';
  throw new Error('未识别的导入格式：支持角色卡、预设、世界书、正则、表格和气泡资源包');
}

export async function importBytes(store, sourceName, bytes) {
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('文件为空或超过 128 MB');
  const sourceHash = hash(bytes);
  const results = [];
  const add = async (name, kind, data, cover) => {
    const id = hash(`${sourceHash}:${name}:${kind}`).slice(0, 32);
    const item = await store.putItem({ id, kind, name: kind === 'card' ? (data.data ?? data).name : name.replace(/\.[^.]+$/, ''), sourceName: basename(sourceName), sourceHash, ...(cover ? { cover } : {}), data });
    const { data: ignored, ...summary } = item;
    results.push(summary);
  };
  const importJson = async (name, value, files) => {
    if (Array.isArray(value) && value.length && value.every(isAdvanceProfile)) {
      for (const [index, profile] of value.entries()) await add(profile.name || `${name} ${index + 1}`, 'advance', profile);
      return;
    }
    const kind = identifyJson(value);
    if (kind === 'bubble') {
      value = structuredClone(value);
      for (const entry of [...value.avatars, ...(value.moodAvatars ?? [])]) {
        if (entry.zipPath) {
          const resource = files?.get(zipName(entry.zipPath));
          if (!resource) throw new Error(`气泡资源缺失：${entry.zipPath}`);
          const extension = extname(entry.zipPath).slice(1).toLowerCase();
          if (!['png', 'webp', 'jpg', 'jpeg', 'gif', 'avif'].includes(extension)) throw new Error('气泡头像必须是图片');
          entry.assetId = await store.putAsset(resource, extension);
        }
      }
    }
    await add(name, kind, value);
  };
  const extension = extname(sourceName).toLowerCase();
  if (extension === '.zip') {
    const files = unzip(bytes);
    const manifest = [...files].find(([name]) => name === 'manifest.json');
    if (manifest) {
      const data = json(manifest[1]);
      if (identifyJson(data) === 'bubble') { await importJson(sourceName, data, files); return results; }
    }
    for (const [name, content] of files) {
      if (name.startsWith('__MACOSX/') || name.endsWith('/')) continue;
      if (/\.json$/i.test(name)) await importJson(name, json(content), files);
      if (/\.png$/i.test(name)) {
        const card = parseCardPng(content);
        await add(name, 'card', card, await store.putAsset(content, 'png'));
      }
    }
    if (!results.length) throw new Error('压缩包中没有可导入的角色卡或预设');
  } else if (extension === '.png') {
    await add(sourceName, 'card', parseCardPng(bytes), await store.putAsset(bytes, 'png'));
  } else if (extension === '.json') await importJson(sourceName, json(bytes));
  else throw new Error('请选择 JSON、PNG 或 ZIP 文件');
  return results;
}

export async function importPath(store, path) {
  if (typeof path !== 'string' || !path.trim()) throw new Error('请输入文件路径');
  path = resolve(store.root, path);
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_BYTES) throw new Error('路径不是文件或文件超过 128 MB');
  return importBytes(store, basename(path), await readFile(path));
}

export async function importLegacyPrompts(store, tavernPath) {
  const settings = json(await readFile(resolve(store.root, tavernPath, 'data/default-user/settings.json')));
  const userscripts = settings.extension_settings?.__userscripts ?? {};
  const imported = [];
  // Only portable prompts cross this boundary; connections and credentials stay in Tavern.
  for (const group of Object.values(userscripts)) {
    if (!group || typeof group !== 'object') continue;
    for (const [name, raw] of Object.entries(group)) {
      if (!name.endsWith('settings') || typeof raw !== 'string') continue;
      const data = JSON.parse(raw);
      if (!data.plotSettings && !data.charCardPrompt) continue;
      const value = { plotSettings: data.plotSettings, charCardPrompt: data.charCardPrompt };
      imported.push(...await importBytes(store, '酒馆推进与填表预设.json', Buffer.from(JSON.stringify(value))));
    }
  }
  return imported;
}
