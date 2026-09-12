import React, { useEffect, useState } from 'react';
import { api } from './native-browser.js';
import { presetPrompts } from './presets.js';
import { currentFacts } from './memory-state.js';
import { ResourceImporter } from './native-resources.jsx';
import { createMessageActions } from './native-messages.jsx';

const labels = { recall: '召回', combine: '组合', advance: '推进', write: '写作', memory: '记忆', table: '填表' };
const pages = { resources: '角色卡与预设', messages: '历史消息', agents: '模型与输入', memory: '角色记忆', tables: '表格', frontend: '前端与变量' };
const globalPages = { resources: '角色卡与预设', agents: '模型与输入', frontend: '显示方式' };
const clone = value => structuredClone(value);
const selectedFields = ['cardId', 'presetId', 'toolPresetId', 'tableId', 'legacyId', 'bubbleId', 'renderMode', 'userName', 'persona', 'worldbookIds', 'regexIds'];
const fromState = state => Object.fromEntries(selectedFields.map(key => [key, state[key]]));

function StateFacts({ episodes, title }) {
  const facts = currentFacts(episodes);
  if (!facts.length) return null;
  return <details><summary>{title}</summary>{facts.map(fact => <details key={fact.id}><summary>{fact.subject} · {fact.key}：{fact.value}</summary><p>{fact.evidence.quote}</p><small>{new Date(fact.createdAt).toLocaleString()}</small></details>)}</details>;
}

function ModelAttempts({ sessionId }) {
  const [records, setRecords] = useState([]), [error, setError] = useState(''), [loaded, setLoaded] = useState(false);
  return <details><summary>失败与重试记录</summary><button onClick={async () => { try { setRecords(await api('/model-attempts?id=' + sessionId)); setLoaded(true); setError(''); } catch (error) { setError(error.message); } }}>读取记录</button>{error && <p role="alert">{error}</p>}{loaded && !records.length && <p>暂无记录</p>}{records.map(record => <details key={record.taskId + ':' + record.attempt}><summary>{new Date(record.createdAt).toLocaleString()} · {record.label} · 第 {record.attempt} 次尝试 · {{ retrying: '将重试', failed: '失败', succeeded: '成功' }[record.status]}</summary>{record.error && <p>{record.error.message}</p>}<pre>{JSON.stringify(record.response, null, 2)}</pre></details>)}</details>;
}

function ResourceSelect({ label, kind, value, change, library, required, children }) {
  return <label>{label}<select value={value || ''} onChange={event => change(event.target.value)}><option value="">{required ? '选择角色卡' : children || '内置默认'}</option>{library.filter(item => item.kind === kind).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;
}

function ModelFields({ value, change, providers, name, sessionId, compact = false }) {
  const [info, setInfo] = useState(), [error, setError] = useState('');
  useEffect(() => {
    let active = true; setInfo(undefined); setError('');
    api('/model-info?' + new URLSearchParams({ sessionId: sessionId ?? '', provider: value.provider ?? '', model: value.model ?? '' })).then(info => { if (active) setInfo(info); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [sessionId, value.provider, value.model]);
  const efforts = info?.reasoning?.efforts ?? [];
  const models = providers.find(provider => provider.provider === value.provider)?.models ?? [];
  const set = (key, next) => change({ ...value, [key]: next });
  return <div className="tavern-model">
    {!compact && <label>推理强度<select aria-label={`${name}推理强度`} value={value.reasoningEffort ?? ''} disabled={!info && !value.reasoningEffort} onChange={event => set('reasoningEffort', event.target.value)}><option value="">{info && !efforts.length ? '当前模型默认' : '自动继承支持的设置'}</option>{value.reasoningEffort && !efforts.some(effort => effort.id === value.reasoningEffort) && <option value={value.reasoningEffort}>{value.reasoningEffort}（当前模型不支持）</option>}{efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name ?? effort.id}</option>)}</select>{info && !efforts.length && <span className="tavern-caption">此模型不接受额外推理强度参数。</span>}{error && <span className="tavern-error">{error}</span>}</label>}
    <div className="tavern-grid"><label>提供方<select aria-label={`${name}提供方`} value={value.provider} onChange={event => set('provider', event.target.value)}><option value="">跟随输入框模型</option>{providers.map(provider => <option key={provider.provider} value={provider.provider}>{provider.displayName ?? provider.provider}</option>)}</select></label><label>模型<input aria-label={`${name}模型`} list={`tavern-model-${name}`} value={value.model} placeholder="留空跟随输入框" onChange={event => set('model', event.target.value)} /><datalist id={`tavern-model-${name}`}>{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</datalist></label></div>
    {!compact && <details><summary>参数与附加提示词</summary><div className="tavern-grid"><label>温度<input type="number" min="0" max="2" step="0.05" value={value.temperature ?? ''} placeholder="继承预设" onChange={event => set('temperature', event.target.value === '' ? null : Number(event.target.value))} /></label><label>结构化结果<select value={value.protocol} onChange={event => set('protocol', event.target.value)}><option value="tool">工具调用</option><option value="json">JSON 协议块</option></select></label></div><textarea aria-label={`${name}附加提示词`} rows="3" value={value.prompt} onChange={event => set('prompt', event.target.value)} /></details>}
  </div>;
}

function PresetEditor({ id, sessionId, scope, override, saved }) {
  const [preset, setPreset] = useState(), [query, setQuery] = useState(''), [error, setError] = useState('');
  useEffect(() => { setPreset(undefined); if (override) setPreset(clone(override)); else if (id) api('/item?id=' + id).then(item => setPreset(item.data)).catch(error => setError(error.message)); }, [id, sessionId, override]);
  if (!id) return null;
  const update = (id, work) => { const next = clone(preset); work(next.prompts.find(p => (p.identifier ?? p.id) === id), (next.prompt_order.find(order => order.character_id === 100001) ?? next.prompt_order[0]).order); setPreset(next); };
  return <details className="tavern-preset-editor"><summary>编辑预设提示词</summary>{error && <p role="alert">{error}</p>}{preset && <><input type="search" aria-label="查找预设提示词" value={query} onChange={event => setQuery(event.target.value)} placeholder="查找提示词" />{presetPrompts(preset).filter(prompt => !query || prompt.name?.includes(query)).map(prompt => <details key={prompt.id}><summary><input type="checkbox" aria-label={`启用 ${prompt.name}`} checked={prompt.enabled} onClick={event => event.stopPropagation()} onChange={event => update(prompt.id, (_entry, order) => { order.find(item => item.identifier === prompt.id).enabled = event.target.checked; })} /> {prompt.name || prompt.id}</summary>{!prompt.marker && <textarea rows="5" value={prompt.content ?? ''} onChange={event => update(prompt.id, entry => { entry.content = event.target.value; })} />}<div className="tavern-actions">{[-1, 1].map(delta => <button key={delta} onClick={() => update(prompt.id, (_entry, order) => { const i = order.findIndex(item => item.identifier === prompt.id), j = i + delta; if (j >= 0 && j < order.length) [order[i], order[j]] = [order[j], order[i]]; })}>{delta === -1 ? '上移' : '下移'}</button>)}</div></details>)}<button onClick={async () => { try { await api('/item', { id, data: preset, sessionId, scope }); await saved(); setError(''); } catch (error) { setError(error.message); } }}>保存预设内容</button></>}</details>;
}

export function createSettings(runtime) {
  const MessageActions = createMessageActions(runtime);
  return function TavernSettings({ useSessions, sessionId: boundSessionId, embedded = false, initialPage = 'resources', scope = 'session' }) {
    const global = scope === 'global';
    const current = useSessions(list => list.byId[list.current]?.projectionValues?.agentPreset === 'tavern' ? list.current : undefined);
    const sessionId = global ? undefined : boundSessionId ?? current;
    const available = global ? globalPages : pages;
    const [page, setPage] = useState(available[initialPage] ? initialPage : 'resources'), [data, setData] = useState(), [payload, setPayload] = useState(), [selection, setSelection] = useState({});
    const [config, setConfig] = useState(), [message, setMessage] = useState(''), [error, setError] = useState(false), [busy, setBusy] = useState(false);
    const [configurationId, setConfigurationId] = useState(''), [configuration, setConfiguration] = useState();
    const [history, setHistory] = useState([]), [legacyPath, setLegacyPath] = useState('');
    const [actorId, setActorId] = useState(''), [actor, setActor] = useState(), [tableId, setTableId] = useState(''), [tables, setTables] = useState({}), [variables, setVariables] = useState('{}');
    async function load() {
      const [data, configurations] = await Promise.all([runtime.bootstrap(true), api('/configurations')]); setData({ ...data, configurations });
      setConfigurationId(''); setConfiguration(undefined);
      let payload = sessionId ? await api('/native-state?id=' + sessionId) : undefined;
      setPayload(payload); setSelection(payload?.state ? fromState(payload.state) : global ? { ...data.selection } : { ...payload?.selection }); setConfig(clone(payload?.state?.config ?? payload?.config ?? data.config));
      setHistory(payload?.state ? await api('/messages?id=' + sessionId) : []);
      setTables(clone(payload?.state?.tables ?? {})); setVariables(JSON.stringify(payload?.state?.variables ?? {}, null, 2));
      return payload;
    }
    useEffect(() => { load().catch(error => { setMessage(error.message); setError(true); }); }, [sessionId]);
    useEffect(() => { const list = payload?.state?.characters ?? []; const current = list.find(actor => actor.id === actorId) ?? list[0]; setActorId(current?.id ?? ''); setActor(current ? clone(current) : undefined); }, [payload, actorId]);
    async function action(work, success = '已保存') { setBusy(true); setMessage(''); try { await work(); setError(false); setMessage(success); } catch (error) { setError(true); setMessage(error.message); } finally { setBusy(false); } }
    async function refresh() { if (sessionId) await runtime.refresh(sessionId, true); await load(); }
    async function saveSelection() {
      const next = { ...selection, presetId: selection.presetId || null, toolPresetId: selection.toolPresetId || null, legacyId: selection.legacyId || null, bubbleId: selection.bubbleId || null };
      const id = global ? (await api('/native-selection', { selection: next, configuration }), undefined) : await runtime.selectCard(sessionId, next, configuration);
      await api('/configurations', { selection: next, configuration: { config, ...(configuration ?? {}) } });
      if (!id || id === sessionId) await load();
    }
    const change = key => value => setSelection(previous => ({ ...previous, [key]: value, ...(key === 'cardId' && previous.cardId && value !== previous.cardId ? { tableId: null } : {}) }));
    const state = payload?.state;
    if (!data || !config) return <div className="tavern-settings">{message || '正在读取酒馆设置…'}</div>;
    const tableEntries = Object.entries(tables).filter(([key]) => key.startsWith('sheet_'));
    const selectedTable = tableEntries.find(([key]) => key === tableId) ?? tableEntries[0];
    return <section className="tavern-settings">
      {!embedded && <h2>酒馆模式</h2>}{global && <p className="tavern-caption">新对话的默认配置；当前对话的配置在输入框上方修改。</p>}<div className="tavern-submenu" role="tablist" aria-label="酒馆设置">{Object.entries(available).map(([key, label]) => <button role="tab" key={key} aria-selected={page === key} onClick={() => { setPage(key); setMessage(''); }}>{label}</button>)}</div>
      {message && <p role={error ? 'alert' : 'status'} className={error ? 'tavern-error' : 'tavern-notice'}>{message}</p>}
      <fieldset disabled={busy} className="tavern-page" role="tabpanel">
      {page === 'resources' && <>
        <label>历史配置<select aria-label="历史配置" value={configurationId} onChange={event => {
          const profile = data.configurations.find(profile => profile.id === event.target.value); setConfigurationId(event.target.value);
          if (profile) { setSelection(clone(profile.selection)); setConfig(clone(profile.configuration.config)); setConfiguration(clone(profile.configuration)); }
          else setConfiguration(undefined);
        }}><option value="">选择之前使用过的配置</option>{data.configurations.map(profile => <option key={profile.id} value={profile.id}>{profile.name} · {new Date(profile.updatedAt).toLocaleString()}</option>)}</select></label>
        <ResourceImporter imported={load} />
        <ResourceSelect label="角色卡" kind="card" required value={selection.cardId} change={change('cardId')} library={data.library} />
        <div className="tavern-grid"><ResourceSelect label="写作预设" kind="preset" value={selection.presetId} change={change('presetId')} library={data.library}>SillyTavern Default</ResourceSelect><ResourceSelect label="工具预设" kind="preset" value={selection.toolPresetId} change={change('toolPresetId')} library={data.library}>不使用</ResourceSelect><ResourceSelect label="推进与填表预设" kind="advance" value={selection.legacyId} change={change('legacyId')} library={data.library} /><ResourceSelect label="表格模板" kind="tables" value={selection.tableId} change={change('tableId')} library={data.library}>随角色卡</ResourceSelect></div>
        {global && <label>你的名字<input value={selection.userName ?? '你'} onChange={event => change('userName')(event.target.value)} /></label>}<label>你的角色设定<textarea rows="3" value={selection.persona ?? ''} onChange={event => change('persona')(event.target.value)} /></label>
        <details><summary>附加世界书与正则</summary>{[['worldbookIds', 'worldbook', '世界书'], ['regexIds', 'regex', '正则']].map(([key, kind, name]) => <label key={key}>{name}<select multiple value={selection[key] ?? []} onChange={event => change(key)([...event.target.selectedOptions].map(option => option.value))}>{data.library.filter(item => item.kind === kind).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>)}</details>
        <button className="tavern-save" onClick={() => action(saveSelection)}>保存选择</button>
        <PresetEditor id={selection.presetId} sessionId={sessionId} scope={scope} override={selection.presetId === (state?.presetId ?? (global ? data.selection : payload?.selection)?.presetId) ? (state?.presetOverride ?? (global ? data : payload)?.presetOverride) : undefined} saved={refresh} />
        <PresetEditor id={selection.toolPresetId} saved={refresh} />
        <details><summary>读取本机酒馆配置</summary><label>SillyTavern 目录<input value={legacyPath} placeholder="相对酒馆数据目录的路径" onChange={event => setLegacyPath(event.target.value)} /></label><button disabled={!legacyPath.trim()} onClick={() => action(async () => { await api('/import-legacy', { path: legacyPath.trim() }); await load(); }, '推进与填表预设已导入')}>读取本机酒馆的推进与填表预设</button></details>
      </>}
      {page === 'agents' && <>
        <label>玩法<select aria-label="玩法" value={config.playMode ?? 'agent'} onChange={event => setConfig({ ...config, playMode: event.target.value })}><option value="agent">多 agent</option><option value="normal">普通</option></select></label>
        <p className="tavern-caption">{(config.playMode ?? 'agent') === 'normal' ? '普通模式像酒馆一样直接用写作预设和世界书玩，不拆 agent、不召回、不填表。' : '各阶段会自动执行。模型留空时跟随 dsh 输入框中的选择。卡片世界书按酒馆扫描注入写作，不经 agent 挑选。'}</p>
        <label>普通模式最大输入（估算 token）<input type="number" min="1" value={config.normalMaxInputTokens ?? 200000} onChange={event => setConfig({ ...config, normalMaxInputTokens: Number(event.target.value) })} /></label>
        {Object.entries(labels).filter(([key]) => config.playMode !== 'normal' || key === 'write').map(([key, label]) => <details key={key} open={key === 'advance' || key === 'write'}><summary>{config.playMode === 'normal' ? '写作模型' : `${label} agent`}</summary><ResourceSelect label="预设" kind="preset" value={config.agents[key].presetId ?? ''} change={value => setConfig(previous => ({ ...previous, agents: { ...previous.agents, [key]: { ...previous.agents[key], presetId: value } } }))} library={data.library}>{key === 'write' ? '写作预设' : '工具预设'}</ResourceSelect><ModelFields name={label} value={config.agents[key]} providers={data.providers} sessionId={sessionId} change={value => setConfig(previous => ({ ...previous, agents: { ...previous.agents, [key]: { ...previous.agents[key], ...value } } }))} /></details>)}
        {config.playMode !== 'normal' && <div className="tavern-grid"><label>并发数<input type="number" min="1" max="16" value={config.concurrency} onChange={event => setConfig({ ...config, concurrency: Number(event.target.value) })} /></label><label>近期对话轮数<input type="number" min="1" value={config.historyTurns} onChange={event => setConfig({ ...config, historyTurns: Number(event.target.value) })} /></label><label>自动纠错重试次数<input type="number" min="0" max="3" value={config.protocolRetries} onChange={event => setConfig({ ...config, protocolRetries: Number(event.target.value) })} /><span className="tavern-caption">失败后额外尝试的次数，推进预设也使用此设置。</span></label></div>}
        <button className="tavern-save" onClick={() => action(async () => { for (const agent of Object.values(config.agents)) if (!!agent.provider !== !!agent.model) throw new Error('提供方和模型需一起填写，或一起留空'); await api('/config', { config, ...(!global ? { sessionId, revision: state?.revision } : {}) }); await refresh(); })}>保存模型配置</button>
        {sessionId && <ModelAttempts key={sessionId} sessionId={sessionId} />}
      </>}
      {page === 'messages' && <>{history.map((entry, index) => <details key={entry.id ?? entry.nativeMessageId}><summary>第 {index + 1} 楼 · {entry.role === 'user' ? '你' : entry.role === 'assistant' ? '模型' : '旁白'} · {entry.content.slice(0, 40)}</summary><MessageActions sessionId={sessionId} payload={payload} message={entry.id ? entry : undefined} nativeMessageId={entry.nativeMessageId} role={entry.role} text={entry.content} changed={refresh}><pre>{entry.content}</pre></MessageActions></details>)}</>}
      {page === 'memory' && <>
        {state && actor && <StateFacts episodes={state.memories[actor.id]} title="当前状态与已知信息" />}
        {!state ? <p>开始酒馆会话后可查看角色记忆。</p> : <><label>角色<select value={actorId} onChange={event => setActorId(event.target.value)}>{state.characters.map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>{!actor && <p className="tavern-caption">剧情推进时会识别出场角色；后续出现的新角色也会建立独立记忆。</p>}{actor && <><details><summary>角色设置</summary><label>姓名<input value={actor.name} onChange={event => setActor({ ...actor, name: event.target.value })} /></label><label>基础设定<textarea rows="5" value={actor.profile ?? ''} onChange={event => setActor({ ...actor, profile: event.target.value })} /></label><label className="tavern-check"><input type="checkbox" checked={actor.enabled !== false} onChange={event => setActor({ ...actor, enabled: event.target.checked })} />参与剧情</label>{[['recallModel', '角色召回'], ['memoryModel', '角色记忆']].map(([key, name]) => <ModelFields key={key} compact name={name} value={actor[key] ?? { provider: '', model: '' }} providers={data.providers} sessionId={sessionId} change={value => setActor({ ...actor, [key]: value })} />)}<button onClick={() => action(async () => { const next = { ...actor }; for (const key of ['recallModel', 'memoryModel']) { if (!next[key]?.provider && !next[key]?.model) delete next[key]; else if (!next[key]?.provider || !next[key]?.model) throw new Error('角色模型需同时填写提供方与模型'); } await api('/session', { id: sessionId, revision: state.revision, fields: { characters: state.characters.map(item => item.id === next.id ? next : item) } }); await refresh(); })}>保存角色设置</button></details>{(state.memories[actor.id] ?? []).toReversed().map(memory => <details key={memory.id}><summary>{memory.summary || new Date(memory.createdAt).toLocaleString()}</summary>{memory.facts.map((fact, index) => <p key={index}>{fact}</p>)}{memory.relationships.map((fact, index) => <p key={'r' + index}>{fact}</p>)}{memory.openThreads.map((fact, index) => <p key={'t' + index}>{fact}</p>)}</details>)}{!(state.memories[actor.id]?.length) && <p className="tavern-caption">剧情完成后会自动记录此角色的经历。</p>}</>}</>}
      </>}
      {page === 'tables' && <>
        {state && <StateFacts episodes={state.worldHistory} title="当前世界状态" />}
        {!selectedTable ? <p>选择角色卡后即可使用内置表格。</p> : <><label>表格<select value={selectedTable[0]} onChange={event => setTableId(event.target.value)}>{tableEntries.map(([key, table]) => <option key={key} value={key}>{table.name}</option>)}</select></label><div className="tavern-table"><table><thead><tr>{selectedTable[1].content[0].map((header, index) => <th key={index}>{header}</th>)}</tr></thead><tbody>{selectedTable[1].content.slice(1).map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, column) => <td key={column}><input aria-label={`${selectedTable[1].content[0][column]} 第${rowIndex + 1}行`} value={value ?? ''} onChange={event => { const next = clone(tables); next[selectedTable[0]].content[rowIndex + 1][column] = typeof value === 'number' ? Number(event.target.value) : event.target.value; setTables(next); }} /></td>)}</tr>)}</tbody></table></div><button className="tavern-save" onClick={() => action(async () => { await api('/session', { id: sessionId, revision: state.revision, fields: { tables } }); await refresh(); })}>保存表格修改</button><details><summary>模板规则</summary><pre>{JSON.stringify(selectedTable[1].sourceData, null, 2)}</pre></details></>}
      </>}
      {page === 'frontend' && <>
        {data.helper && <div><p>酒馆助手 {data.helper.version} · <a href={data.helper.repository} target="_blank" rel="noreferrer">官方源码</a></p>{global && <label className="tavern-check"><input type="checkbox" checked={data.helper.autoUpdate} onChange={event => action(async () => { await api('/helper', { autoUpdate: event.target.checked }); await load(); })} />自动检查并更新</label>}<button onClick={() => action(async () => { await api('/helper', { check: true }); await load(); }, '已检查酒馆助手更新')}>检查更新</button>{data.helper.checkedAt && <p className="tavern-caption">上次检查：{new Date(data.helper.checkedAt).toLocaleString()}</p>}{data.helper.error && <p className="tavern-error" role="alert">{data.helper.error}</p>}</div>}
        <label>显示方式<select value={selection.renderMode ?? 'card'} onChange={event => change('renderMode')(event.target.value)}><option value="card">角色卡正则与前端组件</option><option value="bubble">内置气泡</option><option value="text">原始文本</option></select></label><button className="tavern-save" onClick={() => action(saveSelection)}>保存显示方式</button>
        {state && <><details><summary>聊天变量</summary><textarea className="tavern-code" rows="10" aria-label="聊天变量 JSON" value={variables} onChange={event => setVariables(event.target.value)} /><button onClick={() => action(async () => { await api('/runtime', { sessionId, method: 'variables', args: { variables: JSON.parse(variables) } }); await refresh(); })}>保存变量</button></details><details><summary>角色脚本</summary><button onClick={() => action(() => runtime.script(sessionId), '')}>打开脚本界面</button>{(runtime.controller(sessionId)?.buttons ?? []).map(button => <button key={button.id} onClick={() => action(() => runtime.script(sessionId, button.id), '')}>{button.name}</button>)}</details></>}
      </>}
      </fieldset>
    </section>;
  };
}
