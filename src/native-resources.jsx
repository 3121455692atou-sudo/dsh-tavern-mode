import React, { useEffect, useRef, useState } from 'react';
import { api } from './native-browser.js';

export function ResourceImporter({ imported }) {
  const input = useRef();
  const [busy, setBusy] = useState(false), [dragging, setDragging] = useState(false), [paths, setPaths] = useState('');
  const [message, setMessage] = useState(''), [errors, setErrors] = useState([]);
  async function importResources(sources) {
    setBusy(true); setMessage(''); setErrors([]);
    const items = [], failures = [];
    try {
      for (const source of sources) {
        try {
          let value;
          if (typeof source === 'string') value = { path: source };
          else {
            const bytes = new Uint8Array(await source.arrayBuffer());
            let encoded = '';
            for (let offset = 0; offset < bytes.length; offset += 8192) encoded += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
            value = { name: source.name, base64: btoa(encoded) };
          }
          items.push(...(await api('/import', value)).items);
        } catch (error) { failures.push(`${typeof source === 'string' ? source : source.name}：${error.message}`); }
      }
      if (items.length) { await imported(items); setMessage(`已导入 ${items.length} 项资源`); }
    } catch (error) { failures.push(error.message); }
    finally { setErrors(failures); setBusy(false); }
  }
  return <div className="tavern-import">
    <input ref={input} type="file" aria-label="导入角色卡、预设或资源包" accept=".json,.png,.zip" multiple hidden disabled={busy} onChange={event => { const files = [...event.target.files]; event.target.value = ''; if (files.length) importResources(files); }} />
    <button type="button" className="tavern-import-drop" data-dragging={dragging || undefined} disabled={busy} onClick={() => input.current.click()}
      onDragOver={event => { event.preventDefault(); event.stopPropagation(); setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={event => { event.preventDefault(); event.stopPropagation(); setDragging(false); window.dispatchEvent(new Event('dragend')); if (!busy && event.dataTransfer.files.length) importResources([...event.dataTransfer.files]); }}>
      <span className="tavern-import-plus" aria-hidden="true">＋</span>
      <strong>{busy ? '正在导入…' : '导入角色卡、预设或资源包'}</strong>
      <span className="tavern-caption">点击选择或拖入文件 · PNG / JSON / ZIP</span>
    </button>
    <details className="tavern-import-path"><summary>从本机路径导入</summary><label>本机文件路径<textarea rows="2" placeholder="每行一个完整路径" value={paths} onChange={event => setPaths(event.target.value)} /></label><button type="button" disabled={busy || !paths.trim()} onClick={() => importResources(paths.split('\n').map(path => path.trim()).filter(Boolean))}>导入文件</button></details>
    {message && <p role="status">{message}</p>}{errors.map((error, index) => <p className="tavern-error" role="alert" key={index}>{error}</p>)}
  </div>;
}

export function ResourceLibrary({ runtime, sessionId, selected }) {
  const [data, setData] = useState(), [query, setQuery] = useState(''), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const load = async () => {
    const [next, payload] = await Promise.all([runtime.bootstrap(true), api('/native-state?id=' + encodeURIComponent(sessionId))]);
    const selection = payload.state ? Object.fromEntries(['cardId', 'presetId', 'toolPresetId', 'tableId', 'legacyId', 'bubbleId', 'renderMode', 'userName', 'persona', 'worldbookIds', 'regexIds'].map(key => [key, payload.state[key]])) : payload.selection;
    setData({ ...next, selection });
  };
  useEffect(() => { load().catch(error => setError(error.message)); }, [sessionId]);
  async function choose(card) {
    setBusy(card.id); setError('');
    try {
      const id = await runtime.selectCard(sessionId, { ...data.selection, cardId: card.id, ...(data.selection?.cardId && data.selection.cardId !== card.id ? { tableId: null } : {}) });
      selected?.(id);
    } catch (error) { setError(error.message); }
    finally { setBusy(''); }
  }
  const cards = data?.library.filter(item => item.kind === 'card' && (!query || `${item.name}\n${item.sourceName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))) ?? [];
  return <section className="tavern-settings tavern-library">
    <div className="tavern-library-title"><div><h2>选择角色卡</h2><p className="tavern-caption">导入角色卡后，选择一张开始会话。</p></div></div>
    <ResourceImporter imported={load} />
    {error && <p className="tavern-error" role="alert">{error}</p>}
    {data?.library.some(item => item.kind === 'card') && <input className="tavern-card-search" type="search" aria-label="查找角色卡" placeholder="查找角色卡" value={query} onChange={event => setQuery(event.target.value)} />}
    {!data && !error && <p className="tavern-caption">正在读取角色卡…</p>}
    <div className="tavern-card-grid">{cards.map(card => <button type="button" className="tavern-card" key={card.id} disabled={!!busy} onClick={() => choose(card)}>
      {card.cover ? <img src={'/api/tavern/asset?id=' + encodeURIComponent(card.cover)} alt="" /> : <span className="tavern-card-cover" aria-hidden="true">{card.name[0]}</span>}
      <span className="tavern-card-info"><strong>{busy === card.id ? '正在打开…' : card.name}</strong><small>{card.sourceName}</small></span>
    </button>)}</div>
  </section>;
}
