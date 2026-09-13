import React, { useRef, useState } from 'react';

export function createRecoveryNotice(runtime) {
  return function RecoveryNotice({ sessionId, payload, ready }) {
    const submitting = useRef(false);
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const recovery = payload?.recovery;
    if (!recovery || payload.generating) return null;
    const label = recovery.failures?.length > 1 ? '从失败步骤继续' : `从「${recovery.label}」继续`;
    async function resume() {
      if (submitting.current) return;
      submitting.current = true; setBusy(true); setError('');
      try { await runtime.retryFailed(sessionId, recovery.token); }
      catch (error) { setError(error.message); }
      finally { submitting.current = false; setBusy(false); }
    }
    return <div className="tavern-recovery tavern-settings" role="status">
      <span>{recovery.kind === 'updates' ? '正文已保存，更新未完成。' : '本轮尚未完成。'}{recovery.completedSteps > 0 ? `已保存 ${recovery.completedSteps} 个步骤，继续时会复用。` : '将从未完成的步骤继续。'}</span>
      <button disabled={busy || !ready} onClick={resume}>{busy ? '正在继续…' : label}</button>
      {error && <p className="tavern-error" role="alert">{error}</p>}
    </div>;
  };
}
