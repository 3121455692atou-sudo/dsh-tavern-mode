import React, { useState } from 'react';

export function createMessageActions(runtime) {
  return function MessageActions({ sessionId, payload, message, nativeMessageId, text, role, children, changed }) {
    const [editing, setEditing] = useState(false), [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const disabled = busy || payload.generating;
    const canReroll = !!nativeMessageId && !message?.greeting;
    const content = payload.state.helperChat?.find(item => item.tavernMessageId === message?.id)?.mes ?? message?.content ?? payload.state.nativeMessageOverrides?.[nativeMessageId] ?? text;
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
