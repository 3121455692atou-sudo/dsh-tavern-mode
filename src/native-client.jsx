import React, { useEffect, useRef, useSyncExternalStore, useState } from 'react';
import { MarkdownText, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives';
import { applyRegex, macroEnvironment } from './macros.js';
import { api, createBrowserRuntime } from './native-browser.js';
import { bindComponent } from './native-component-binding.jsx';
import { createSettings } from './native-settings.jsx';
import { displaySegments } from './display.js';
import { withoutLegacyBubble } from './speech-frame.js';
import { ResourceLibrary } from './native-resources.jsx';
import { createMessageActions } from './native-messages.jsx';
import { extractInteraction, interactionHtml } from './interaction.js';

export const inject = ['slots', 'sessions', 'conversation', 'workspaces', 'uiWorkspace'];
const markdownLabels = { copy: '复制', copied: '已复制', code: '代码', open: '打开', download: '下载' };


export function apply(ctx) {
  const runtime = createBrowserRuntime(ctx);
  const Settings = createSettings(runtime);
  const MessageActions = createMessageActions(runtime);
  const style = document.createElement('style'); style.dataset.plugin = 'dsh-tavern-mode';
  style.textContent = `.tavern-settings{color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.6;min-width:0}.tavern-settings h2{font-size:20px;margin:0 0 18px}.tavern-submenu{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:10px;margin-bottom:18px}.tavern-settings button{color:inherit;font:inherit;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:transparent;padding:6px 10px;cursor:pointer}.tavern-settings button:hover,.tavern-submenu [aria-selected=true]{background:var(--dsw-alias-interactive-bg-hover)}.tavern-settings button:disabled{opacity:.5;cursor:default}.tavern-page{border:0;margin:0;padding:0;min-width:0}.tavern-settings label{display:flex;flex-direction:column;gap:6px;margin:12px 0}.tavern-settings input:not([type=checkbox]),.tavern-settings textarea,.tavern-settings select{font:inherit;color:inherit;background:var(--dsw-alias-fill-tsp-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:8px;width:100%;box-sizing:border-box}.tavern-settings select option{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}.tavern-settings textarea{resize:vertical}.tavern-settings summary{cursor:pointer;padding:9px 0}.tavern-settings details{border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:8px}.tavern-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 14px}.tavern-actions{display:flex;gap:8px;margin:8px 0}.tavern-save{margin:10px 0 18px}.tavern-caption{color:var(--dsw-alias-label-tertiary)}.tavern-error{color:var(--dsw-alias-state-error-primary)}.tavern-check{flex-direction:row!important;align-items:center}.tavern-table{overflow:auto;margin:14px 0}.tavern-table table{border-collapse:collapse;width:100%}.tavern-table td,.tavern-table th{border:1px solid var(--dsw-alias-border-l1);padding:6px;min-width:100px;text-align:left}.tavern-settings pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.tavern-native-component{display:block;width:100%;border:0;min-height:24px;margin:8px 0;background:transparent;color-scheme:inherit}.tavern-greeting{font-size:var(--dsh-content-font-size,14px);line-height:1.8;margin-bottom:20px}@media(max-width:560px){.tavern-grid{grid-template-columns:1fr}}`;
  style.textContent += `
    .tavern-shell{--dsh-chat-content-width:clamp(680px,64vw,920px);--dsh-composer-card-max-width:calc(var(--dsh-chat-content-width) + 32px);--dsh-composer-side-clearance:16px;--dsh-composer-dock-inset:8px;display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
    .tavern-scroll{display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;position:relative;scrollbar-gutter:stable}
    .tavern-scroll>[data-slot="conversation.session"]{flex:1 0 auto;min-height:auto}
    .tavern-opening,.tavern-entry{box-sizing:border-box;width:min(var(--dsh-chat-content-width),calc(100% - 32px));margin:0 auto;padding:24px 0;min-width:0}
    .tavern-entry{flex:1;padding-top:clamp(24px,6vh,60px);padding-bottom:32px}
    .tavern-composer{position:relative;z-index:7;flex:none;padding-top:12px;background:var(--dsw-alias-bg-base)}
    .tavern-toolbar{box-sizing:border-box;width:min(var(--dsh-composer-card-max-width),calc(100% - 32px));margin:0 auto 6px;padding:0 8px;color:var(--dsw-alias-label-primary);font:13px/1.5 var(--dsw-font-family,system-ui)}
    .tavern-toolbar-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .tavern-toolbar-row>button,.tavern-toolbar-row>select{font:inherit;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:4px 10px;cursor:pointer;min-height:30px}
    .tavern-toolbar-row>select{width:auto}
    .tavern-toolbar-row>button:hover,.tavern-toolbar-row>select:hover{background:var(--dsw-alias-interactive-bg-hover)}
    .tavern-current-card{max-width:min(260px,45vw);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .tavern-settings-dialog{width:min(920px,calc(100vw - 32px));max-height:calc(100dvh - 48px)}
    .tavern-settings-dialog>div{min-height:0;flex:1}
    .tavern-settings-dialog>div>:first-child{flex-shrink:0}
    .tavern-settings-dialog>div>:last-child{min-height:0;overflow-y:auto;overscroll-behavior:contain}
    .tavern-message{min-width:0}.tavern-message-actions{display:flex;gap:12px;flex-wrap:wrap;margin:8px 0 18px}
    .tavern-message-actions button{font:inherit;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary);background:transparent;border:0;border-radius:5px;padding:4px;cursor:pointer}
    .tavern-message-actions button:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.tavern-message-actions button:disabled{opacity:.5;cursor:default}
    .tavern-message-editor{box-sizing:border-box;width:100%;min-height:160px;height:320px;max-height:60dvh;resize:vertical;padding:12px;font:inherit;color:inherit;background:var(--dsw-alias-fill-tsp-secondary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px}
    .tavern-library-title h2{margin:0;font-size:21px}.tavern-library-title p{margin:6px 0 20px}
    .tavern-settings .tavern-import-drop{display:grid;justify-items:center;gap:5px;width:100%;padding:20px;border-style:dashed;border-radius:12px;background:var(--dsw-alias-fill-tsp-secondary)}
    .tavern-import-plus{font-size:26px;line-height:1.2;color:var(--dsw-alias-label-tertiary)}
    .tavern-import-drop[data-dragging]{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-brand-primary)}
    .tavern-import-path{border:0!important;margin:4px 0 14px}.tavern-import-path summary{font-size:12px;color:var(--dsw-alias-label-tertiary)}
    .tavern-card-search{margin:0 0 14px}
    .tavern-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
    .tavern-settings .tavern-card{display:flex;align-items:center;text-align:left;gap:12px;padding:12px;min-width:0;border-radius:12px}
    .tavern-card img,.tavern-card-cover{width:66px;height:88px;object-fit:cover;border-radius:7px;flex:none;background:var(--dsw-alias-fill-tsp-secondary)}
    .tavern-card-cover{display:grid;place-items:center;font-size:27px;color:var(--dsw-alias-label-tertiary)}
    .tavern-card-info{display:flex;flex-direction:column;gap:8px;min-width:0;overflow-wrap:anywhere}.tavern-card-info strong{font-size:13px;line-height:1.5}.tavern-card-info small{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary)}
    .tavern-settings button:focus-visible,.tavern-toolbar button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
    @media(max-width:560px){.tavern-toolbar{width:100%;padding:0 12px}.tavern-card-grid{grid-template-columns:1fr}.tavern-entry{padding-top:22px}}
  `;
  document.head.append(style);
  const usePayload = id => useSyncExternalStore(callback => runtime.subscribe(id, callback), () => runtime.get(id));

  function Component({ sessionId, source, index }) {
    const ref = useRef();
    const [error, setError] = useState('');
    const { ready, runtimeId } = usePayload(sessionId);
    useEffect(() => {
      if (!ready) return;
      setError('');
      let disposed = false, port;
      (async () => {
        const controller = await runtime.ensure(sessionId);
        if (disposed || !controller) return;
        const settings = await runtime.bootstrap();
        if (disposed) return;
        const frame = ref.current;
        frame.onload = () => {
          const channel = new MessageChannel(); port = channel.port1;
          port.onmessage = event => {
            if (event.data.type === 'height' && Number.isFinite(event.data.height)) frame.style.height = Math.max(24, event.data.height) + 'px';
            else if (event.data.type === 'error') setError(event.data.message);
          };
          frame.contentWindow.postMessage({ type: 'tavern-component', hubId: controller.hubId, index, html: source }, settings.runtimeOrigin, [channel.port2]);
        };
        frame.src = settings.runtimeOrigin + '/component';
      })().catch(error => setError(error.message));
      return () => { disposed = true; port?.close(); };
    }, [sessionId, source, index, ready, runtimeId]);
    return <>{error && <p role="alert">{error}</p>}{ready && <iframe key={runtimeId} ref={ref} className="tavern-native-component" title="角色卡前端组件" allow="clipboard-write" sandbox="allow-scripts allow-same-origin allow-modals allow-downloads" />}</>;
  }

  function renderText(text, payload, index, sessionId, native, placement = 2) {
    const state = payload.state, mode = state.renderMode ?? 'card';
    if (state.helperChat?.find(message => message.tavernMessageId === state.messages[index]?.id)?.is_system ?? state.messages[index]?.is_hidden) return null;
    text = state.helperChat?.find(message => message.tavernMessageId === state.messages[index]?.id)?.mes ?? state.messages[index]?.content ?? text;
    if (mode === 'text') return <pre style={{ whiteSpace: 'pre-wrap', font: 'inherit' }}>{text}</pre>;
    const interaction = placement === 2 ? extractInteraction(text) : { text, panel: null }; text = interaction.text;
    const env = macroEnvironment({ user: state.userName, char: payload.card.name, variables: state.variables, globalVariables: state.globalVariables, characterVariables: state.characterVariables, presetVariables: state.presetVariables, messageVariables: state.messageVariables, messageId: index < 0 ? undefined : index, messageSwipes: Object.fromEntries((state.helperChat ?? []).map((message, index) => [index, message.swipe_id ?? 0])), messages: state.messages, sessionId });
    const displayed = mode === 'card' ? applyRegex(text, withoutLegacyBubble(payload.regex), { phase: 'display', placement, depth: Math.max(0, state.messages.length - index - 1), env }) : text;
    const parts = displaySegments(displayed, placement === 2, { cardId: payload.cardId, userName: state.userName });
    if (interaction.panel && (interaction.panel.status.length || interaction.panel.choices.length)) parts.push({ html: interactionHtml(interaction.panel) });
    return parts.map((part, key) => part.html !== undefined ? <Component key={key} sessionId={sessionId} source={part.html} index={index} /> : <React.Fragment key={key}>{native(part.text)}</React.Fragment>);
  }

  for (const key of ['user', 'steering']) ctx.slots.inject('conversation.chat.node', () => {
    const original = ctx.slots.entriesOfSlot('conversation.chat.node').find(entry => entry.options.key === key);
    return bindComponent(original, Original => {
    function User(props) {
      const preset = props.useProjection('agentPreset');
      const { payload } = usePayload(props.sessionId);
      if (preset !== 'tavern' || !payload) return <Original {...props} />;
      if (hiddenNode(payload.state, props.node) || payload.state.deletedNativeMessageIds?.includes(props.node.id)) return null;
      const text = payload.state.nativeMessageOverrides?.[props.node.id] ?? props.node.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
      const attachments = props.node.data.content.filter(block => block.type !== 'text');
      let index = payload.state.messages.findIndex(message => message.nativeMessageId === props.node.id);
      if (index < 0) index = payload.state.messages.findLastIndex(message => message.role === 'user' && message.content === text);
      const render = content => <Original {...props} node={{ ...props.node, data: { ...props.node.data, content } }} />;
      let start = index;
      while (start > 0 && payload.state.messages[start - 1].scriptCreated) start--;
      return <>{payload.state.messages.slice(Math.max(0, start), Math.max(0, index)).map((message, offset) => standaloneMessage(message, payload, start + offset, props.sessionId))}<MessageActions sessionId={props.sessionId} payload={payload} message={payload.state.messages[index]} nativeMessageId={props.node.id} role="user" text={text}>{renderText(text, payload, index, props.sessionId, text => render([{ type: 'text', text }]), 1)}{attachments.length > 0 && render(attachments)}</MessageActions></>;
    }
    return User;
    });
  });

  ctx.slots.inject('conversation.chat.node', () => {
    const original = ctx.slots.entriesOfSlot('conversation.chat.node').find(entry => entry.options.key === 'assistant-step');
    if (!original) throw new Error('dsh 原生消息渲染器尚未加载');
    return bindComponent(original, Original => {
    function Assistant(props) {
      const preset = props.useProjection('agentPreset');
      const { payload } = usePayload(props.sessionId);
      if (preset !== 'tavern' || !payload) return <Original {...props} />;
      if (hiddenNode(payload.state, props.node) || payload.state.deletedNativeMessageIds?.includes(props.node.data.finalNode?.messageId)) return null;
      if (props.node.data.status !== 'settled') return <Original {...props} />;
      const text = payload.state.nativeMessageOverrides?.[props.node.data.finalNode?.messageId] ?? props.node.data.blocks.filter(block => block.kind === 'text').map(block => block.text).join('');
      if (!text) return <Original {...props} />;
      const index = payload.state.messages.findIndex(message => message.nativeMessageId === props.node.data.finalNode?.messageId);
      const messageIndex = index < 0 ? payload.state.messages.findLastIndex(message => message.content === text) : index;
      if (messageIndex < 0) return <Original {...props} />;
      return <MessageActions sessionId={props.sessionId} payload={payload} message={payload.state.messages[messageIndex]} nativeMessageId={props.node.data.finalNode?.messageId} role="assistant" text={text}>{renderText(text, payload, messageIndex, props.sessionId, content => <Original {...props} node={{ ...props.node, data: { ...props.node.data, blocks: [{ kind: 'text', text: content }] } }} />)}</MessageActions>;
    }
    return Assistant;
    });
  });
  function hiddenNode(state, node) { return state.hiddenNativeRanges?.some(([start, end]) => node.anchorSeq >= start && node.anchorSeq < end); }
  ctx.slots.inject('conversation.chat.node', () => {
    const disposers = ctx.slots.entriesOfSlot('conversation.chat.node').filter(entry => !['user', 'steering', 'assistant-step'].includes(entry.options.key)).map(original => {
      return bindComponent(original, Original => {
      function ChatNode(props) {
        const preset = props.useProjection('agentPreset'), { payload } = usePayload(props.sessionId);
        if (preset !== 'tavern' || !payload) return <Original {...props} />;
        if (hiddenNode(payload.state, props.node)) return null;
        const closing = props.node.data.closing, id = closing?.finalNode?.messageId;
        if (id && payload.state.deletedNativeMessageIds?.includes(id)) return null;
        const text = id && payload.state.nativeMessageOverrides?.[id];
        return <Original {...props} node={text === undefined ? props.node : { ...props.node, data: { ...props.node.data, closing: { ...closing, blocks: [{ kind: 'text', text }] } } }} />;
      }
      return ChatNode;
      });
    });
    return () => disposers.forEach(dispose => dispose());
  });
  function standaloneMessage(message, payload, index, sessionId) {
    return <MessageActions key={message.id} sessionId={sessionId} payload={payload} message={message} role={message.role} text={message.content}>{renderText(message.content, payload, index, sessionId, text => <MarkdownText text={text} labels={markdownLabels} />, message.role === 'user' ? 1 : 2)}</MessageActions>;
  }
  function Opening({ sessionId, payload, blank }) {
    const messages = payload.state.messages;
    let start = messages.length;
    while (start > 0 && messages[start - 1].scriptCreated) start--;
    if (!blank && start === messages.length) return null;
    return <div className="tavern-opening">{messages[0]?.greeting && blank && <div className="tavern-greeting">{standaloneMessage(messages[0], payload, 0, sessionId)}</div>}{messages.slice(start).map((message, offset) => standaloneMessage(message, payload, start + offset, sessionId))}</div>;
  }

  ctx.slots.inject('conversation.input.dock', () => {
    const original = ctx.slots.entriesOfSlot('conversation.hero.agentPreset')[0];
    const Mode = original.component;
    return ctx.slots.register({ name: 'conversation.input.dock', id: 'tavern-toolbar', order: 20, locale: original.locale, inject: original.inject }, function Toolbar(props) {
      const preset = props.useProjection('agentPreset');
      const { payload, notice } = usePayload(props.sessionId);
      const [modal, setModal] = useState('');
      if (preset !== 'tavern') return null;
      const buttons = runtime.controller(props.sessionId)?.buttons ?? [];
      return <div className="tavern-toolbar">
        <div className="tavern-toolbar-row">
          <Mode {...props} select={mode => runtime.changeMode(mode).catch(error => error.message)} />
          <select aria-label="玩法" value={payload?.state?.config?.playMode ?? payload?.config?.playMode ?? 'agent'} onChange={event => {
            const playMode = event.target.value;
            const config = { ...(payload?.state?.config ?? payload?.config), playMode };
            api('/config', { config, sessionId: props.sessionId, ...(payload?.state?.revision != null ? { revision: payload.state.revision } : {}) }).then(() => runtime.refresh(props.sessionId, true)).catch(error => runtime.report(props.sessionId, error.message));
          }}><option value="agent">多 agent</option><option value="normal">普通</option></select>
          <button className="tavern-current-card" title={payload?.card.name ?? '选择角色卡'} onClick={() => setModal('cards')}>{payload?.card.name ?? '角色卡'}</button>
          <button onClick={() => setModal('resources')}>导入</button>
          <button onClick={() => setModal('resources')}>预设</button>
          <button onClick={() => setModal('agents')}>{(payload?.state?.config?.playMode ?? payload?.config?.playMode) === 'normal' ? '最大输入与模型' : '多 agent'}</button>
          <button onClick={() => runtime.script(props.sessionId, '台词框').catch(error => runtime.report(props.sessionId, error.message))}>台词框</button>
          {buttons.filter(button => button.name !== '台词框' && button.name !== '对话气泡').map(button => <button key={button.id} onClick={() => runtime.script(props.sessionId, button.id).catch(error => runtime.report(props.sessionId, error.message))}>{button.name}</button>)}
        </div>
        {notice && <Toast key={notice.id} text={notice.message} holdMs={notice.timeOut === 0 ? 2147483647 : notice.timeOut ?? 3000} anchor={document.querySelector('[data-composer-card]')} icon={<button aria-label="关闭通知" onClick={() => runtime.clearNotice(props.sessionId, notice.id)}>×</button>} onDone={() => runtime.clearNotice(props.sessionId, notice.id)} />}
        <Modal open={!!modal} onClose={() => setModal('')} title={modal === 'cards' ? '角色卡' : '本对话设置'} closeLabel="关闭" className="tavern-settings-dialog">
          {modal === 'cards' ? <ResourceLibrary runtime={runtime} sessionId={props.sessionId} selected={() => setModal('')} /> : modal && <Settings {...props} embedded initialPage={modal} key={modal} scope="session" sessionId={props.sessionId} />}
        </Modal>
      </div>;
    });
  });

  ctx.slots.inject('main.conversation', () => {
    const original = ctx.slots.entriesOfSlot('main.conversation')[0];
    return bindComponent(original, Original => {
    function TavernConversation(props) {
      const session = props.useSession(value => value);
      const input = props.useInput(value => value);
      const pendingInteraction = props.useSessionPendingInteraction(value => value.get(props.sessionId));
      const { payload, error, loaded, ready } = usePayload(props.sessionId);
      const shell = useRef(), scroll = useRef(), composer = useRef();
      useEffect(() => {
        runtime.mountView(props.sessionId, shell.current);
        const measure = () => {
          scroll.current?.style.setProperty('--dsh-composer-height', `${composer.current?.offsetHeight ?? 0}px`);
          scroll.current?.style.setProperty('--dsh-conversation-viewport-height', `${scroll.current?.clientHeight ?? 0}px`);
        };
        const observer = new ResizeObserver(measure);
        observer.observe(scroll.current); observer.observe(composer.current); measure();
        return () => { observer.disconnect(); runtime.mountView(props.sessionId, null); };
      }, [props.sessionId]);
      const reason = !payload ? '请先导入并选择角色卡' : !ready ? '正在加载角色前端…' : undefined;
      const bar = <>
        {session && input && props.renderSlot('conversation.input.dock', { session, input })}
        {props.renderSlot('conversation.composer.bar', { variant: 'composer', placeholder: reason ?? '发送消息，继续剧情…', ...(reason ? { blocked: { reason } } : {}) })}
      </>;
      return <div className="tavern-shell" ref={shell}>
        {props.renderSlot('conversation.session.header', {})}
        <div className="tavern-scroll" data-conversation-scroll="" ref={scroll}>
          {!payload ? <div className="tavern-entry">{error && <p role="alert" className="tavern-error">{error}</p>}{loaded || error ? <ResourceLibrary runtime={runtime} sessionId={props.sessionId} /> : <p>正在读取酒馆…</p>}</div> : <>
            {session?.blank ? <Opening sessionId={props.sessionId} payload={payload} blank /> : <>{props.renderSlot('conversation.session', {})}<Opening sessionId={props.sessionId} payload={payload} /></>}
            {error && <div className="tavern-opening"><p className="tavern-error" role="alert">{error}</p><button onClick={() => runtime.refresh(props.sessionId, true)}>重新加载前端</button></div>}
          </>}
        </div>
        <div className="tavern-composer" data-composer-seat="" ref={composer}>{props.renderSlotChain('conversation.composer', { sessionId: props.sessionId, session, pendingInteraction }, { fallback: bar, overlay: true })}</div>
      </div>;
    }
    function Conversation(props) {
      const preset = props.useSessions(list => list.byId[props.sessionId]?.projectionValues?.agentPreset);
      return preset === 'tavern' ? <TavernConversation {...props} /> : <Original {...props} />;
    }
    // Keep the native declaration owner and its bound child-slot renderers.
    return Conversation;
    });
  });

  const originalNewSession = ctx.uiWorkspace.startSession;
  const newSession = function(workspaceId) {
    const list = ctx.sessions.list.getSnapshot(), current = list.byId[list.current];
    if (current?.projectionValues?.agentPreset !== 'tavern') return originalNewSession.call(this, workspaceId);
    void runtime.newSession(undefined, workspaceId).catch(error => runtime.report(current.id, error.message));
  };
  ctx.uiWorkspace.startSession = newSession;
  ctx.effect(() => () => { if (ctx.uiWorkspace.startSession === newSession) ctx.uiWorkspace.startSession = originalNewSession; });

  let seatStore, stopSeat, settingsDispose, active = false;
  function updateMode() {
    const list = ctx.sessions.list.getSnapshot(), current = list.current && list.byId[list.current];
    const selected = current && !current.blank ? current.projectionValues?.agentPreset : seatStore?.getSnapshot().current ?? current?.projectionValues?.agentPreset;
    const next = selected === 'tavern';
    if (next !== active) {
      active = next;
      if (active) settingsDispose = ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'tavern-mode', order: 45, label: () => '酒馆模式' }, props => <Settings {...props} scope="global" />));
      else { settingsDispose?.(); settingsDispose = undefined; }
    }
    const keep = new Set(list.ids.filter(id => list.byId[id].projectionValues?.agentPreset === 'tavern' && (id === list.current || (list.byId[id].running && runtime.controller(id)))));
    runtime.retain(keep);
    for (const id of keep) { runtime.ensure(id); runtime.setRunning(id, !!list.byId[id].running); }
  }
  function observeSeat() {
    const entry = ctx.slots.entriesOfSlot('conversation.hero.agentPreset')[0];
    const store = entry?.inject?.().hooks?.agentPresetSeat;
    if (store !== seatStore) { stopSeat?.(); seatStore = store; stopSeat = seatStore?.subscribe(updateMode); }
    updateMode();
  }
  const stopSlots = ctx.slots.subscribe('conversation.hero.agentPreset', observeSeat);
  const stopSessions = ctx.sessions.list.subscribe(updateMode);
  observeSeat();
  ctx.effect(() => () => { stopSlots(); stopSessions(); stopSeat?.(); settingsDispose?.(); runtime.dispose(); style.remove(); });
}
