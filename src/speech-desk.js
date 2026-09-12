const DB_NAME = 'BubbleDialogueAvatars';
const DB_VERSION = 4;
const SCRIPT_ID = '0c67965d-93ca-4572-81af-a1190caab464';
const MOODS = [
  { id: 'mood-joy', label: '喜悦', words: ['开心', '欢喜', '欣喜', '愉悦', '满足', '幸福', '甜蜜', '兴奋', '得意', '自信'] },
  { id: 'mood-anger', label: '愤怒', words: ['愤怒', '气愤', '暴躁', '恼火', '窝火', '生气', '烦躁', '强势'] },
  { id: 'mood-sad', label: '难过', words: ['难过', '伤心', '忧伤', '失落', '沮丧', '心痛', '委屈', '孤独'] },
  { id: 'mood-anxious', label: '紧张', words: ['焦虑', '紧张', '不安', '忐忑', '慌张', '害怕', '恐惧'] },
  { id: 'mood-calm', label: '平静', words: ['平静', '冷静', '从容', '安定', '淡然', '平和'] },
  { id: 'mood-shy', label: '害羞', words: ['害羞', '腼腆', '不好意思', '脸红', '扭捏'] },
  { id: 'mood-disgust', label: '嫌弃', words: ['嫌弃', '厌恶', '不屑', '鄙夷', '无奈'] },
  { id: 'mood-love', label: '喜欢', words: ['爱恋', '温柔', '眷恋', '心软', '珍视'] },
];
const FORMAT_RULE = `角色开口、心里话必须单独成行。

说话：
[角色|完整全名|情绪]〖台词〗

心里话：
[角色|完整全名|情绪]{内心}

规则：
1. 全名每次写全，不要省略姓氏。
2. 情绪从当前情绪词里选，不能空着。
3. 旁白、动作、环境直接写，不要套标记。
4. 玩家自己说话写成 [角色|user|情绪]〖台词〗。
5. 还不知道名字时用 [角色|？？？|情绪]〖台词〗。
6. 正文外层用 <now_plot><content>……</content></now_plot>。

示例：
<now_plot>
<content>
灯站在门口，手指还抠着书包带。

[角色|林岚|不安]〖那个……对不起。〗

[角色|林岚|紧张]{又搞砸了吗}

立希没回头。

[角色|周川|强势]〖别动。〗
</content>
</now_plot>`;
const MOOD_TEMPLATE = `情绪必须从下面选：
{{mood_groups}}`;

const hostDoc = () => { try { return parent.document; } catch { return document; } };
const request = value => new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
const complete = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });

function openDb() {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DB_NAME, DB_VERSION);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      const make = (name, key) => { if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: key }); };
      make('avatars', 'alias'); make('config', 'key'); make('mood_avatars', 'id'); make('local_fonts', 'id'); make('cg_groups', 'id'); make('cg_images', 'id');
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
}
async function getConfig(key, fallback = null) {
  const db = await openDb();
  try { return (await request(db.transaction('config').objectStore('config').get(key)))?.value ?? fallback; }
  finally { db.close(); }
}
async function setConfig(key, value) {
  const db = await openDb();
  try {
    const tx = db.transaction('config', 'readwrite');
    tx.objectStore('config').put({ key, value });
    await complete(tx);
  } finally { db.close(); }
}
async function formatRule() {
  const saved = await getConfig('format_rule', '');
  if (!saved || /@bubble:/.test(saved) || /bubble-character/i.test(saved) || /〖\*/.test(saved)) {
    await setConfig('format_rule', FORMAT_RULE);
    return FORMAT_RULE;
  }
  return saved;
}
function aliasOf(name) { return `_global___${String(name).trim().toLowerCase()}`; }
async function listAvatars() {
  const db = await openDb();
  try {
    const rows = await request(db.transaction('avatars').objectStore('avatars').getAll());
    return rows.filter(row => row.name !== 'user');
  } finally { db.close(); }
}
async function saveAvatar(name, blob, sourceUrl, color) {
  const id = '_global_';
  const alias = aliasOf(name, id);
  const db = await openDb();
  try {
    const tx = db.transaction(['avatars', 'config'], 'readwrite');
    const prev = await request(tx.objectStore('avatars').get(alias));
    tx.objectStore('avatars').put({ alias, charId: id, name: name.trim(), imageBlob: blob || prev?.imageBlob || null, sourceUrl: sourceUrl || prev?.sourceUrl || null });
    if (color) tx.objectStore('config').put({ key: `color_${alias}`, value: color });
    await complete(tx);
  } finally { db.close(); }
}
async function removeAvatar(name) {
  const db = await openDb();
  try {
    const tx = db.transaction(['avatars', 'mood_avatars', 'config'], 'readwrite');
    const moods = await request(tx.objectStore('mood_avatars').getAll());
    for (const row of moods) if (row.name.trim().toLowerCase() === name.trim().toLowerCase()) tx.objectStore('mood_avatars').delete(row.id);
    tx.objectStore('avatars').delete(aliasOf(name));
    tx.objectStore('config').delete(`color_${aliasOf(name)}`);
    await complete(tx);
  } finally { db.close(); }
}

let injectHandle;
async function applyInjection() {
  if (injectHandle) { try { injectHandle.uninject(); } catch {} injectHandle = null; }
  const rule = await formatRule();
  let groups = MOODS;
  try { const parsed = JSON.parse(await getConfig('mood_config', 'null')); if (parsed?.groups) groups = parsed.groups; } catch {}
  const template = (await getConfig('mood_prompt_template', MOOD_TEMPLATE)) || MOOD_TEMPLATE;
  const table = groups.map(group => `${group.label}：${(group.words || []).join('、')}`).join('\n');
  const content = `${rule}\n\n${template.replace(/\{\{mood_groups\}\}/g, table)}`;
  if (typeof injectPrompts === 'function') {
    injectHandle = injectPrompts([{ id: 'speech-desk-format', position: 'before_prompt', role: 'system', content, should_scan: false }]);
    return;
  }
  try { SillyTavern.getContext().setExtensionPrompt('speech-desk-format', content, 0, 0, false, 0); } catch {}
}

function css() {
  return `
.sd-mask{position:fixed;inset:0;z-index:30000;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;padding:24px;font:17px/1.45 -apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC",sans-serif;color:#1d1d1f}
.sd-sheet{width:min(920px,100%);height:min(820px,86vh);background:#fff;border-radius:16px;box-shadow:0 24px 80px rgba(0,0,0,.28);display:flex;flex-direction:column;overflow:hidden}
.sd-head{display:flex;align-items:center;padding:14px 20px 8px}
.sd-head strong{font-size:20px;font-weight:650}
.sd-close{margin-left:auto;width:36px;height:36px;border:0;border-radius:18px;background:#f2f2f7;color:#1d1d1f;font-size:22px;line-height:1;cursor:pointer}
.sd-tabs{display:flex;gap:4px;margin:0 20px 8px;padding:4px;background:#f2f2f7;border-radius:10px}
.sd-tabs button{flex:1;border:0;background:transparent;padding:8px 6px;border-radius:8px;cursor:pointer;color:#6e6e73;font:inherit}
.sd-tabs button.sd-on{background:#fff;color:#1d1d1f;font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.sd-body{flex:1;min-height:0;overflow:auto;padding:16px 20px 24px}
.sd-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:12px}
.sd-person{border:1px solid #e5e5ea;background:#fafafa;border-radius:12px;padding:12px 8px;cursor:pointer;text-align:center;color:inherit}
.sd-person.sd-on{border-color:#0071e3;background:#e8f1fc}
.sd-face{width:72px;height:72px;margin:0 auto 8px;overflow:hidden;display:grid;place-items:center;background:#d8d8de}
.sd-face img{width:100%;height:100%;object-fit:cover;object-position:top}
.sd-form{margin-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:12px 16px}
.sd-form label,.sd-stack label{display:flex;flex-direction:column;gap:6px;font-size:13px;color:#6e6e73}
.sd-form input,.sd-form select,.sd-stack input,.sd-stack textarea,.sd-stack select{font:inherit;color:#1d1d1f;background:#f2f2f7;border:0;border-radius:10px;padding:10px 12px}
.sd-stack{display:flex;flex-direction:column;gap:12px}
.sd-stack textarea{min-height:220px;width:100%;resize:vertical}
.sd-actions{display:flex;gap:8px;margin-top:16px}
.sd-primary{border:0;background:#0071e3;color:#fff;border-radius:10px;padding:10px 16px;font:inherit;font-weight:600;cursor:pointer}
.sd-danger{border:0;background:transparent;color:#ff3b30;padding:10px 12px;font:inherit;cursor:pointer}
.sd-edit{display:grid;grid-template-columns:180px 1fr;gap:20px;margin-top:20px;align-items:start}
.sd-preview .sd-face{width:160px;height:160px;margin:0}
.sd-thumbs{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.sd-thumbs img,.sd-thumb{width:80px;height:80px;object-fit:cover;object-position:top;border-radius:10px;background:#d8d8de}
.sd-drop{border:1.5px dashed #c7c7cc;border-radius:14px;padding:36px 20px;text-align:center;color:#6e6e73;background:#fafafa}
.sd-drop.sd-over{border-color:#0071e3;background:#e8f1fc;color:#0071e3}
.sd-mood{border:1px solid #e5e5ea;border-radius:12px;padding:12px;margin-bottom:10px}
@media (prefers-color-scheme: dark){
  .sd-mask{color:#f5f5f7}
  .sd-sheet{background:#1c1c1e}
  .sd-close,.sd-form input,.sd-form select,.sd-stack input,.sd-stack textarea,.sd-stack select{background:#2c2c2e;color:#f5f5f7}
  .sd-tabs{background:#2c2c2e}
  .sd-tabs button{color:#98989d}
  .sd-tabs button.sd-on{background:#3a3a3c;color:#f5f5f7}
  .sd-person{background:#2c2c2e;border-color:#3a3a3c}
  .sd-person.sd-on{background:#0a3266;border-color:#0a84ff}
  .sd-drop{background:#2c2c2e;border-color:#3a3a3c;color:#98989d}
  .sd-mood{border-color:#3a3a3c}
}
`;
}
function faceStyle() {
  const pts = [];
  for (let i = 0; i <= 48; i++) {
    const t = (i / 48) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    pts.push(`${((Math.sign(c) * Math.abs(c) ** (2 / 3) + 1) * 50).toFixed(2)}% ${((Math.sign(s) * Math.abs(s) ** (2 / 3) + 1) * 50).toFixed(2)}%`);
  }
  return `clip-path:polygon(${pts.join(',')})`;
}
function fileToBlob(file) { return file ? file.arrayBuffer().then(buf => new Blob([buf], { type: file.type || 'image/png' })) : Promise.resolve(null); }
function blobSrc(blob) { return blob ? URL.createObjectURL(blob) : ''; }
async function readAvatar(name) {
  const db = await openDb();
  try { return await request(db.transaction('avatars').objectStore('avatars').get(aliasOf(name))); }
  finally { db.close(); }
}
async function readMood(name, moodId) {
  const db = await openDb();
  try { return await request(db.transaction('mood_avatars').objectStore('mood_avatars').get(`${aliasOf(name)}__${moodId}`)); }
  finally { db.close(); }
}
function mountPreview(doc, host, src) {
  host.replaceChildren();
  if (!src) return;
  const img = doc.createElement('img');
  img.src = src;
  host.append(img);
}
function bindImageInputs(doc, fileInput, urlInput, face) {
  fileInput?.addEventListener('change', () => { const file = fileInput.files[0]; if (file) mountPreview(doc, face, URL.createObjectURL(file)); });
  urlInput?.addEventListener('input', () => { const url = urlInput.value.trim(); if (/^https?:\/\//.test(url)) mountPreview(doc, face, url); });
}
function escapeAttr(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

async function importZip(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const files = await unzipBytes(bytes);
  const raw = files.get('manifest.json');
  if (!raw) throw new Error('压缩包里没有 manifest.json');
  const manifest = JSON.parse(new TextDecoder().decode(raw));
  const entries = [...(manifest.avatars || []), ...(manifest.moodAvatars || [])];
  for (const entry of manifest.avatars || []) {
    const path = String(entry.zipPath || '').replace(/^\.?\//, '');
    const data = files.get(path) || files.get(entry.zipPath);
    if (data) await saveAvatar(entry.name, new Blob([data], { type: entry.mimeType || 'image/png' }), '', (manifest.colors || {})[entry.name]);
  }
  if (manifest.moodAvatars) {
    const id = '_global_';
    const db = await openDb();
    const tx = db.transaction('mood_avatars', 'readwrite');
    for (const entry of manifest.moodAvatars) {
      const path = String(entry.zipPath || '').replace(/^\.?\//, '');
      const data = files.get(path) || files.get(entry.zipPath);
      if (!data) continue;
      const alias = aliasOf(entry.name, id);
      tx.objectStore('mood_avatars').put({ id: `${alias}__${entry.moodId}`, alias: entry.name.trim().toLowerCase(), charId: id, name: entry.name, moodId: entry.moodId, imageBlob: new Blob([data], { type: entry.mimeType || 'image/png' }), sourceUrl: null });
    }
    await complete(tx); db.close();
  }
  return entries[0]?.name || '';
}

async function unzipBytes(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const compressed = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extra = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extra;
    const slice = bytes.subarray(start, start + compressed);
    if (method === 0) files.set(name, slice.slice());
    else if (method === 8 && typeof DecompressionStream === 'function') {
      const stream = new Blob([slice]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      files.set(name, new Uint8Array(await new Response(stream).arrayBuffer()));
    }
    offset = start + compressed;
  }
  return files;
}

function openDesk() {
  const doc = hostDoc();
  doc.getElementById('sd-mask')?.remove();
  const mask = doc.createElement('div');
  mask.id = 'sd-mask';
  mask.className = 'sd-mask';
  mask.innerHTML = `<style>${css()}</style><div class="sd-sheet" role="dialog" aria-label="台词框"><div class="sd-head"><strong>台词框</strong><button class="sd-close" type="button" aria-label="关闭">×</button></div><div class="sd-tabs"></div><div class="sd-body"></div></div>`;
  doc.body.append(mask);
  const sheet = mask.querySelector('.sd-sheet');
  sheet.addEventListener('click', event => event.stopPropagation());
  mask.addEventListener('click', () => mask.remove());
  mask.querySelector('.sd-close').onclick = () => mask.remove();
  const tabs = [['cast', '角色'], ['player', '玩家'], ['mood', '情绪'], ['rule', '格式'], ['gallery', '图片'], ['io', '导入导出']];
  const nav = mask.querySelector('.sd-tabs');
  tabs.forEach(([id, label], index) => {
    const button = doc.createElement('button');
    button.type = 'button'; button.textContent = label; button.dataset.tab = id;
    if (!index) button.className = 'sd-on';
    nav.append(button);
  });
  let tab = 'cast', current = '';
  const body = mask.querySelector('.sd-body');
  const paint = async () => {
    body.replaceChildren();
    if (tab === 'cast') {
      const people = await listAvatars();
      const grid = doc.createElement('div'); grid.className = 'sd-grid';
      const addCard = (name, blob, selected) => {
        const card = doc.createElement('button');
        card.type = 'button'; card.className = 'sd-person' + (selected ? ' sd-on' : '');
        card.innerHTML = `<div class="sd-face" style="${faceStyle()}"></div><div>${escapeAttr(name || '添加角色')}</div>`;
        if (blob) { const img = doc.createElement('img'); img.src = URL.createObjectURL(blob); card.querySelector('.sd-face').append(img); }
        card.onclick = () => { current = name; paint(); };
        grid.append(card);
      };
      people.forEach(person => addCard(person.name, person.imageBlob, person.name === current));
      addCard('', null, current === '');
      body.append(grid);
      const selected = people.find(person => person.name === current);
      const edit = doc.createElement('div'); edit.className = 'sd-edit';
      edit.innerHTML = `<div class="sd-preview"><div class="sd-face" id="sd-face" style="${faceStyle()}"></div><div class="sd-thumbs" id="sd-mood-prev"></div></div>
        <div class="sd-form" style="margin:0">
          <label>名字<input id="sd-name" value="${escapeAttr(current)}"></label>
          <label>主题色<input id="sd-color" type="color" value="#88aaff"></label>
          <label>选择图片<input id="sd-file" type="file" accept="image/*"></label>
          <label>图片链接<input id="sd-url" placeholder="https://"></label>
          <label>情绪差分<select id="sd-md">${MOODS.map(mood => `<option value="${mood.id}">${mood.label}</option>`).join('')}</select></label>
          <label>差分图<input id="sd-mfile" type="file" accept="image/*"></label>
        </div>`;
      const actions = doc.createElement('div'); actions.className = 'sd-actions';
      actions.innerHTML = `<button class="sd-primary" type="button" id="sd-save">保存</button><button class="sd-primary" type="button" id="sd-msave">保存差分</button><button class="sd-danger" type="button" id="sd-del">删除</button>`;
      body.append(edit, actions);
      const face = body.querySelector('#sd-face');
      const src = selected?.imageBlob ? blobSrc(selected.imageBlob) : selected?.sourceUrl || '';
      if (src) mountPreview(doc, face, src);
      bindImageInputs(doc, body.querySelector('#sd-file'), body.querySelector('#sd-url'), face);
      const showMood = async () => {
        const name = body.querySelector('#sd-name').value.trim() || current;
        const moodId = body.querySelector('#sd-md').value;
        const record = name ? await readMood(name, moodId) : null;
        const box = body.querySelector('#sd-mood-prev');
        box.replaceChildren();
        if (record?.imageBlob || record?.sourceUrl) {
          const img = doc.createElement('img');
          img.src = record.imageBlob ? blobSrc(record.imageBlob) : record.sourceUrl;
          box.append(img);
        }
      };
      body.querySelector('#sd-md').onchange = showMood;
      showMood();
      bindImageInputs(doc, body.querySelector('#sd-mfile'), null, body.querySelector('#sd-mood-prev'));
      body.querySelector('#sd-save').onclick = async () => {
        const name = body.querySelector('#sd-name').value.trim(); if (!name) return;
        await saveAvatar(name, await fileToBlob(body.querySelector('#sd-file').files[0]), body.querySelector('#sd-url').value.trim(), body.querySelector('#sd-color').value);
        current = name; paint();
      };
      body.querySelector('#sd-msave').onclick = async () => {
        const name = body.querySelector('#sd-name').value.trim(); const file = body.querySelector('#sd-mfile').files[0]; if (!name || !file) return;
        const id = '_global_'; const alias = aliasOf(name, id); const moodId = body.querySelector('#sd-md').value;
        const db = await openDb(); const tx = db.transaction('mood_avatars', 'readwrite');
        tx.objectStore('mood_avatars').put({ id: `${alias}__${moodId}`, alias: name.trim().toLowerCase(), charId: id, name: name.trim(), moodId, imageBlob: await fileToBlob(file), sourceUrl: null });
        await complete(tx); db.close(); showMood();
      };
      body.querySelector('#sd-del').onclick = async () => { if (current) { await removeAvatar(current); current = ''; paint(); } };
    } else if (tab === 'player') {
      const user = await readAvatar('user');
      body.innerHTML = `<div class="sd-edit"><div class="sd-preview"><div class="sd-face" id="sd-uface" style="${faceStyle()}"></div></div>
        <div class="sd-form" style="margin:0">
          <label>你的名字<input id="sd-uname" value="${escapeAttr(SillyTavern.getContext().name1)}"></label>
          <label>选择图片<input id="sd-ufile" type="file" accept="image/*"></label>
          <label>图片链接<input id="sd-uurl" value="${escapeAttr(user?.sourceUrl || '')}" placeholder="https://"></label>
        </div></div>
        <div class="sd-actions"><button class="sd-primary" type="button" id="sd-usave">保存</button></div>
        <p style="color:#6e6e73;font-size:13px;margin-top:12px">这个名字用于当前对话和玩家台词。</p>`;
      const uface = body.querySelector('#sd-uface');
      const usrc = user?.imageBlob ? blobSrc(user.imageBlob) : user?.sourceUrl || '';
      if (usrc) mountPreview(doc, uface, usrc);
      bindImageInputs(doc, body.querySelector('#sd-ufile'), body.querySelector('#sd-uurl'), uface);
      body.querySelector('#sd-usave').onclick = async () => {
        await setUserName(body.querySelector('#sd-uname').value.trim());
        await saveAvatar('user', await fileToBlob(body.querySelector('#sd-ufile').files[0]), body.querySelector('#sd-uurl').value.trim(), '');
        paint();
      };
    } else if (tab === 'mood') {
      let groups = MOODS;
      try { const parsed = JSON.parse(await getConfig('mood_config', 'null')); if (parsed?.groups?.length) groups = parsed.groups; } catch {}
      const stack = doc.createElement('div'); stack.className = 'sd-stack';
      groups.forEach((group, index) => {
        const box = doc.createElement('div'); box.className = 'sd-mood';
        box.innerHTML = `<label>分组<input data-i="${index}" data-k="label" value="${escapeAttr(group.label)}"></label><label>词语（顿号分隔）<input data-i="${index}" data-k="words" value="${escapeAttr((group.words || []).join('、'))}"></label>`;
        stack.append(box);
      });
      body.append(stack);
      const actions = doc.createElement('div'); actions.className = 'sd-actions';
      actions.innerHTML = `<button class="sd-primary" type="button">保存并应用到对话</button>`;
      body.append(actions);
      actions.querySelector('button').onclick = async () => {
        const next = groups.map((group, index) => ({
          ...group,
          label: body.querySelector(`[data-i="${index}"][data-k="label"]`).value.trim() || group.label,
          words: body.querySelector(`[data-i="${index}"][data-k="words"]`).value.split(/[、,，]/).map(word => word.trim()).filter(Boolean),
        }));
        await setConfig('mood_config', JSON.stringify({ groups: next }));
        await applyInjection();
      };
    } else if (tab === 'rule') {
      const rule = await formatRule();
      body.innerHTML = `<div class="sd-stack"><label>写入模型的格式说明<textarea id="sd-rule">${escapeAttr(rule)}</textarea></label></div><div class="sd-actions"><button class="sd-primary" type="button" id="sd-rule-save">保存并应用到对话</button></div>`;
      body.querySelector('#sd-rule-save').onclick = async () => { await setConfig('format_rule', body.querySelector('#sd-rule').value); await applyInjection(); };
    } else if (tab === 'gallery') {
      const db = await openDb();
      const groups = await request(db.transaction('cg_groups').objectStore('cg_groups').getAll());
      const images = db.objectStoreNames.contains('cg_images') ? await request(db.transaction('cg_images').objectStore('cg_images').getAll()) : [];
      db.close();
      body.innerHTML = `<div class="sd-stack"><label>分组名<input id="sd-gname"></label><label>图片地址（一行一个）<textarea id="sd-gurls"></textarea></label></div><div class="sd-thumbs" id="sd-gprev"></div><div class="sd-actions"><button class="sd-primary" type="button" id="sd-gadd">添加</button></div><div id="sd-glist"></div>`;
      const list = body.querySelector('#sd-glist');
      for (const group of groups) {
        const block = doc.createElement('div');
        block.innerHTML = `<p>${escapeAttr(group.name || group.id)}</p><div class="sd-thumbs"></div>`;
        const thumbs = block.querySelector('.sd-thumbs');
        images.filter(image => image.group === group.id).forEach(image => {
          const img = doc.createElement('img');
          img.src = image.sourceUrl || (image.imageBlob ? blobSrc(image.imageBlob) : '');
          if (img.src) thumbs.append(img);
        });
        list.append(block);
      }
      const previewUrls = () => {
        const box = body.querySelector('#sd-gprev');
        box.replaceChildren();
        body.querySelector('#sd-gurls').value.split(/\n/).map(v => v.trim()).filter(url => /^https?:\/\//.test(url)).slice(0, 12).forEach(url => {
          const img = doc.createElement('img'); img.src = url; box.append(img);
        });
      };
      body.querySelector('#sd-gurls').addEventListener('input', previewUrls);
      body.querySelector('#sd-gadd').onclick = async () => {
        const name = body.querySelector('#sd-gname').value.trim(); if (!name) return;
        const id = crypto.randomUUID();
        const store = await openDb();
        const tx = store.transaction(['cg_groups', 'cg_images'], 'readwrite');
        tx.objectStore('cg_groups').put({ id, name });
        body.querySelector('#sd-gurls').value.split(/\n/).map(v => v.trim()).filter(Boolean).forEach(url => tx.objectStore('cg_images').put({ id: crypto.randomUUID(), group: id, sourceUrl: url }));
        await complete(tx); store.close(); paint();
      };
    } else {
      const drop = doc.createElement('div');
      drop.className = 'sd-drop';
      drop.textContent = '把头像压缩包拖到这里，或点这里选择文件';
      const input = doc.createElement('input'); input.type = 'file'; input.accept = '.zip'; input.hidden = true;
      const load = async file => { if (!file) return; current = await importZip(file); tab = 'cast'; nav.querySelectorAll('button').forEach(button => button.classList.toggle('sd-on', button.dataset.tab === 'cast')); paint(); };
      drop.onclick = () => input.click();
      input.onchange = () => load(input.files[0]);
      drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('sd-over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('sd-over'));
      drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('sd-over'); load(event.dataTransfer.files[0]); });
      body.append(drop, input);
    }
  };
  nav.querySelectorAll('button').forEach(button => button.onclick = () => {
    tab = button.dataset.tab;
    nav.querySelectorAll('button').forEach(item => item.classList.toggle('sd-on', item === button));
    paint();
  });
  paint();
}

eventOn(`tavern-button:${SCRIPT_ID}:台词框`, openDesk);
eventOn('tavern-button:台词框', openDesk);
applyInjection().catch(console.warn);
if (typeof eventOn === 'function' && typeof tavern_events !== 'undefined') eventOn(tavern_events.CHAT_CHANGED, () => applyInjection().catch(() => {}));
