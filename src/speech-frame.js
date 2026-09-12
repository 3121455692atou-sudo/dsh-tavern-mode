const SPEECH_LINE = /\[角色\|([^\]|]+)\|([^\]|]+)\](?:〖([^〗]*)〗|\{([^}]*)\})/g;
const OLD_LINE = /^@bubble:([^|\n]+)\|([^|\n]+)\|\[([^\]]*)\]\s*$/;

export function superellipseClip(n = 3, samples = 48) {
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    const x = Math.sign(c) * Math.abs(c) ** (2 / n);
    const y = Math.sign(s) * Math.abs(s) ** (2 / n);
    pts.push(`${((x + 1) * 50).toFixed(2)}% ${((y + 1) * 50).toFixed(2)}%`);
  }
  return `polygon(${pts.join(',')})`;
}

export function nameHue(name) {
  let hash = 2166136261;
  for (const ch of String(name)) hash = Math.imul(hash ^ ch.codePointAt(0), 16777619);
  return (hash >>> 0) % 360;
}

export function monogram(name) {
  const chars = [...String(name).trim()];
  if (chars.length >= 2) return chars[0] + chars.at(-1);
  return chars[0] || '?';
}

export function hasSpeechMarks(text) {
  return /\[角色\|/.test(text) || /^@bubble:/m.test(text) || /<now_plot>/i.test(text);
}

export function withoutLegacyBubble(scripts) {
  return (scripts ?? []).filter(script => {
    const id = script.id || '';
    const name = script.name || script.scriptName || '';
    if (id === 'e3ab57a2-036e-48be-8d76-b272f1b302cc') return false;
    if (/对话渲染/.test(name)) return false;
    return true;
  });
}

export function isPlayerName(name, { userName = '', aliases = '' } = {}) {
  const value = String(name).trim();
  if (/^(user|USER|你)$/i.test(value)) return true;
  if (userName && value === userName) return true;
  for (const item of String(aliases).split(/[,，\n]/).map(part => part.trim()).filter(Boolean)) {
    if (item.startsWith('/') && item.lastIndexOf('/') > 1) {
      const last = item.lastIndexOf('/');
      try { if (new RegExp(item.slice(1, last), item.slice(last + 1)).test(value)) return true; } catch {}
    } else if (item === value) return true;
  }
  return false;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function unwrap(text) {
  return String(text ?? '').replace(/<\/?(?:now_plot|content)\b[^>]*>/gi, '').replace(/\r\n?/g, '\n');
}

function parseThought(speech, thought) {
  const inner = String(speech ?? '').trim();
  if (thought) return { thought: true, text: inner.replace(/^\*|\*$/g, '') };
  if (/^\*[\s\S]*\*$/.test(inner)) return { thought: true, text: inner.replace(/^\*|\*$/g, '') };
  return { thought: false, text: inner };
}

export function parseSpeech(text) {
  const source = unwrap(text);
  const blocks = [];
  let cursor = 0;
  const pushNarration = chunk => {
    const value = chunk.replace(/^\n+|\n+$/g, '');
    if (value.trim()) blocks.push({ kind: 'narration', text: value });
  };
  const takeLine = (start, length, name, mood, speech, thought) => {
    pushNarration(source.slice(cursor, start));
    blocks.push({ kind: 'say', name: name.trim(), mood: mood.trim(), ...parseThought(speech, thought) });
    cursor = start + length;
  };
  for (const match of source.matchAll(SPEECH_LINE)) takeLine(match.index, match[0].length, match[1], match[2], match[3] ?? match[4], match[4] != null);
  if (!blocks.some(block => block.kind === 'say')) {
    const lines = source.split('\n');
    let offset = 0;
    for (const line of lines) {
      const hit = line.match(OLD_LINE);
      if (hit) takeLine(offset, line.length, hit[1], hit[2], hit[3], false);
      offset += line.length + 1;
    }
  }
  pushNarration(source.slice(cursor));
  return blocks;
}

function faceMarkup(name, mood, hue) {
  return `<span class="sd-face" data-name="${escapeHtml(name)}" data-mood="${escapeHtml(mood)}" style="background:oklch(0.42 0.08 ${hue});clip-path:var(--sd-se)"><span class="sd-mono">${escapeHtml(monogram(name))}</span></span>`;
}

export function buildSpeechDocument(text, { cardId = '', userName = '', aliases = '', keepCardName = false } = {}) {
  const clip = superellipseClip(3);
  const rows = parseSpeech(text).map(block => {
    if (block.kind === 'narration') return `<p class="sd-nar">${escapeHtml(block.text).replaceAll('\n', '<br>')}</p>`;
    const player = isPlayerName(block.name, { userName, aliases });
    const label = player && (!keepCardName || /^(user|USER|你)$/i.test(block.name)) ? (userName || block.name) : block.name;
    const faceName = player ? 'user' : block.name;
    const hue = nameHue(label);
    const tone = block.thought ? 'sd-thought' : '';
    return `<div class="sd-row" data-name="${escapeHtml(block.name)}">
      ${faceMarkup(faceName, block.mood, hue)}
      <div class="sd-col">
        <div class="sd-who" style="color:oklch(0.78 0.14 ${hue})"><span class="sd-tag">${escapeHtml(block.mood)}</span>${escapeHtml(label)}</div>
        <div class="sd-qq ${tone}">${escapeHtml(block.text)}</div>
      </div>
    </div>`;
  }).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>
:root{--sd-se:${clip}}
body{margin:0;padding:4px 2px 10px;font:15px/1.65 "Noto Sans SC",system-ui,sans-serif;color:inherit;background:transparent}
.sd-nar{margin:10px 4px;opacity:.82;white-space:pre-wrap}
.sd-row{display:flex;gap:12px;margin:14px 0;align-items:stretch}
.sd-face{flex:none;aspect-ratio:1;height:auto;min-width:64px;max-height:140px;overflow:hidden;display:grid;place-items:center;position:relative;align-self:stretch}
.sd-face img{width:100%;height:100%;object-fit:cover;object-position:top center;position:absolute;inset:0}
.sd-face:has(img) .sd-mono{display:none}
.sd-mono{font:700 15px/1 system-ui,sans-serif;letter-spacing:.04em}
.sd-col{min-width:0;max-width:min(74%,540px);display:flex;flex-direction:column}
.sd-who{display:flex;align-items:baseline;gap:6px;font-size:12px;margin:0 2px 4px;font-weight:650;letter-spacing:.08em}
.sd-tag{font-size:10px;font-weight:500;opacity:.75;border:1px solid currentColor;border-radius:99px;padding:0 6px;letter-spacing:0}
.sd-qq{position:relative;padding:8px 12px;background:#fff;color:#111;border-radius:4px 14px 14px 14px;word-break:break-word;box-shadow:0 1px 2px rgba(0,0,0,.12),0 4px 14px rgba(0,0,0,.1)}
.sd-qq::before{content:"";position:absolute;left:-6px;top:12px;border:6px solid transparent;border-right-color:#fff;border-left:0;filter:drop-shadow(-1px 1px 1px rgba(0,0,0,.08))}
@media (prefers-color-scheme: dark){
  .sd-qq{background:#3a3a3a;color:#f5f5f5;box-shadow:none}
  .sd-qq::before{border-right-color:#3a3a3a;filter:none}
}
.sd-thought{background:transparent;border:1px dashed rgba(120,120,120,.55);color:#888;font-style:italic;box-shadow:none}
.sd-thought::before{display:none}
@media (prefers-color-scheme: dark){
  .sd-thought{color:#9a9a9a;border-color:rgba(255,255,255,.28)}
}
</style></head><body data-card="${escapeHtml(cardId)}">${rows || `<p class="sd-nar">${escapeHtml(unwrap(text))}</p>`}
<script>
(function(){
  function openDb(){
    return new Promise(function(ok,fail){
      var req=indexedDB.open('BubbleDialogueAvatars',4);
      req.onerror=function(){ok(null)};
      req.onsuccess=function(){ok(req.result)};
    });
  }
  function read(db,store,key){
    return new Promise(function(ok){
      if(!db||!db.objectStoreNames.contains(store)){ok(null);return;}
      var g=db.transaction(store).objectStore(store).get(key);
      g.onsuccess=function(){ok(g.result||null)};
      g.onerror=function(){ok(null)};
    });
  }
  function blobUrl(record){
    if(!record) return null;
    if(record.imageBlob) return URL.createObjectURL(record.imageBlob);
    if(record.sourceUrl&&String(record.sourceUrl).indexOf('http')===0) return record.sourceUrl;
    return null;
  }
  openDb().then(function(db){
    document.querySelectorAll('.sd-face[data-name]').forEach(function(el){
      var name=el.getAttribute('data-name')||'';
      var mood=el.getAttribute('data-mood')||'';
      var alias='_global___'+name.trim().toLowerCase();
      var map={开心:'mood-joy',欢喜:'mood-joy',兴奋:'mood-joy',愤怒:'mood-anger',强势:'mood-anger',生气:'mood-anger',难过:'mood-sad',伤心:'mood-sad',紧张:'mood-anxious',不安:'mood-anxious',平静:'mood-calm',冷静:'mood-calm',害羞:'mood-shy',嫌弃:'mood-disgust',无奈:'mood-disgust',温柔:'mood-love',爱恋:'mood-love'};
      Promise.resolve(read(db,'mood_avatars',alias+'__'+mood)).then(function(hit){
        return blobUrl(hit)?hit:read(db,'mood_avatars',alias+'__'+(map[mood]||mood));
      }).then(function(hit){
        return blobUrl(hit)?hit:read(db,'avatars',alias);
      }).then(function(record){
        var url=blobUrl(record);
        if(!url) return;
        var img=document.createElement('img');
        img.alt=''; img.src=url; el.insertBefore(img, el.firstChild);
        var mono=el.querySelector('.sd-mono'); if(mono) mono.remove();
      });
    });
  });
})();
</script></body></html>`;
}
