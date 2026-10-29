import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import { Icon, btn, input } from '../components/ui';

export function LoginPage() {
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/login', { body: { password, remember } });
      qc.clear();
      const next = params.get('next');
      navigate(next?.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError(`密码不对，还可以试 ${err.body.attemptsLeft} 次。连续错 5 次会锁定 15 分钟。`);
      } else if (err instanceof ApiError && err.status === 429) {
        setError(err.message);
      } else {
        setError('登录失败，请稍后重试');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh flex flex-col items-center gap-7 px-4 pt-[18vh] pb-12">
      <div className="flex items-center gap-2.5">
        <Icon name="funnel" size={30} className="text-accent" />
        <span className="text-[22px] font-bold">Idea Funnel</span>
      </div>
      <form onSubmit={submit} aria-labelledby="login-title"
        className="w-full max-w-[380px] flex flex-col gap-4 p-7 rounded-2xl bg-surface border border-line shadow-md">
        <h1 id="login-title" className="text-lg font-bold">输入密码继续</h1>
        <label className="flex flex-col gap-1.5 text-ink-2">
          密码
          <input type="password" autoComplete="current-password" autoFocus required value={password}
            onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error}
            className={`${input} h-11 ${error ? '!border-danger' : ''}`} />
        </label>
        {error && <p role="alert" className="-mt-1.5 text-[13px] text-danger">{error}</p>}
        <label className="flex items-center gap-2 text-ink-2">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4" />
          30 天内记住我
        </label>
        <button type="submit" className={`${btn.primary} min-h-11`} disabled={busy || !password}>{busy ? '登录中…' : '登录'}</button>
      </form>
      <p className="text-[13px] text-muted">个人实例 · 只有你能访问</p>
    </div>
  );
}
