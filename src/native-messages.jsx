import React, { useRef, useState } from 'react';
import { displayMessage } from './native-display.js';

export function createMessageActions(runtime) {
  return function MessageActions({ sessionId, payload, message, nativeMessageId, text, role, children, changed, reasoning = '' }) {
    const [editing, setEditing] = useState(false), [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [copied, setCopied] = useState(false), reasoningRef = useRef();
    const thinking = message?.extra?.reasoning || reasoning;
    const disabled = busy || payload.generating;
    const canReroll = !!nativeMessageId && !message?.greeting;
    const content = displayMessage(payload.state, message, payload.state.nativeMessageOverrides?.[nativeMessageId] ?? text).text;
    async function act(action, text) {
      setBusy(true); setError('');
      try {
        await runtime.messageAction(sessionId, { action, messageId: message?.id, nativeMessageId, ...(text === undefined ? {} : { text }) });
        await changed?.();
        setEditing(false);
      } catch (error) { setError(error.message); }
      finally { setBusy(false); }
    }
    return <div className="tavern-message" data-message-role={role}>
      {message?.id && message.id === payload.state.pendingUpdates?.context?.assistant?.id && <div className="tavern-error" role="status">
        正文已保存。表格或记忆更新{payload.generating ? '进行中' : '未完成'}。
        {payload.state.pendingUpdates.error && <span>{payload.state.pendingUpdates.error}</span>}
        {!payload.generating && <button disabled={busy} onClick={() => runtime.retryUpdates(sessionId)}>仅重试未完成更新</button>}
      </div>}
      {role === 'assistant' && thinking && <details className="tavern-thinking">
        <summary>思考过程 · {Array.from(thinking).length.toLocaleString()} 字符</summary>
        <div className="tavern-message-actions">
          <button onClick={async () => {
            try { await navigator.clipboard.writeText(thinking); setCopied(true); }
            catch { reasoningRef.current?.focus(); reasoningRef.current?.select(); setError('已选中思考原文，请手动复制。'); }
          }}>{copied ? '已复制全部思考' : '复制全部思考'}</button>
        </div>
        <textarea ref={reasoningRef} className="tavern-message-editor tavern-thinking-text" aria-label="思考原文，可选择复制" value={thinking} readOnly spellCheck={false} />
      </details>}
      {editing ? <textarea className="tavern-message-editor" aria-label={role === 'user' ? '编辑用户消息' : '编辑模型消息'} value={draft} onChange={event => setDraft(event.target.value)} autoFocus /> : children}
      <div className="tavern-message-actions">
        {editing ? <>
          <button disabled={disabled} onClick={() => act('edit', draft)}>保存</button>
          {canReroll && role === 'user' && <button disabled={disabled || !draft.trim()} onClick={() => act('reroll', draft)}>保存并重新生成</button>}
          <button disabled={busy} onClick={() => setEditing(false)}>取消</button>
        </> : <>
          <button disabled={disabled} onClick={() => { setDraft(content); setEditing(true); }}>编辑</button>
          {canReroll && <button disabled={disabled} onClick={() => act('reroll')}>{role === 'user' ? '从这里重新生成' : '全部重新生成'}</button>}
          {canReroll && role === 'assistant' && <button disabled={disabled} onClick={() => act('rewrite')}>重写正文</button>}
          <button disabled={disabled} onClick={() => act('delete')}>删除</button>
        </>}
      </div>
      {error && <p className="tavern-error" role="alert">{error}</p>}
    </div>;
  };
}
