import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, notifyAuthChange, useAccounts, useMe } from '../api';
import { btn, input, useToast } from './ui';

const section = 'flex flex-col gap-3 p-5 rounded-2xl bg-surface border border-line';
const field = 'flex flex-col gap-1.5 text-ink-2';

export function AccountSettings() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await api('/auth/logout', { method: 'POST' });
      qc.clear();
      notifyAuthChange();
      navigate('/login', { replace: true });
    } catch {
      toast('退出失败，请重试', 'error');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <section aria-labelledby="account-title" className={section}>
      <h2 id="account-title" className="font-bold">当前账号</h2>
      <p>{me?.username} <span className="text-muted">· {me?.role === 'admin' ? '管理员' : '普通账号'}</span></p>
      <p className="text-muted">你的想法、标签和统计仅自己可见。</p>
      <button type="button" className={`${btn.secondary} self-start`} disabled={busy} onClick={logout}>
        {busy ? '退出中…' : '退出登录'}
      </button>
    </section>
    <ChangePassword />
    {me?.role === 'admin' && <AccountManager />}
  </>;
}

function ChangePassword() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmation) return setError('两次输入的新密码不一致');
    setBusy(true);
    try {
      await api('/auth/password', { body: { currentPassword, newPassword } });
      qc.clear();
      notifyAuthChange();
      toast('密码已修改，请重新登录');
      navigate('/login', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.body.error === 'unauthorized') {
        qc.clear();
        navigate('/login', { replace: true });
      } else if (err instanceof ApiError && err.body.error === 'wrong_password') {
        setError('原密码不正确');
      } else if (err instanceof ApiError && err.status === 429) {
        setError(err.message);
      } else {
        setError('修改密码失败，请检查输入后重试');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="password-title" className={section}>
      <h2 id="password-title" className="font-bold">修改密码</h2>
      <p className="text-muted">新密码需要 10–200 个字符。修改后，所有设备都需要重新登录。</p>
      <form onSubmit={submit} aria-label="修改密码" className="flex flex-col gap-3">
        <label className={field}>原密码
          <input className={input} type="password" autoComplete="current-password" required maxLength={200}
            value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        </label>
        <label className={field}>新密码
          <input className={input} type="password" autoComplete="new-password" required minLength={10} maxLength={200}
            value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </label>
        <label className={field}>确认新密码
          <input className={input} type="password" autoComplete="new-password" required minLength={10} maxLength={200}
            value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        </label>
        {error && <p role="alert" className="text-danger text-[13px]">{error}</p>}
        <button type="submit" className={`${btn.primary} self-start`} disabled={busy}>
          {busy ? '保存中…' : '保存新密码'}
        </button>
      </form>
    </section>
  );
}

function AccountManager() {
  const accounts = useAccounts();
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setCreated('');
    setBusy(true);
    const normalized = username.trim().toLowerCase();
    try {
      await api('/admin/users', { body: { username: normalized, password } });
      setUsername('');
      setPassword('');
      setCreated(`账号 ${normalized} 已创建，请将用户名和初始密码交给使用者。`);
      await qc.invalidateQueries({ queryKey: ['accounts'] });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? '用户名已存在，请换一个' : '创建失败，请检查输入后重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="accounts-title" className={section}>
      <h2 id="accounts-title" className="font-bold">账号管理</h2>
      <p className="text-muted">创建普通账号。每个账号拥有独立的灵感空间，可以使用全部业务功能。</p>
      <form onSubmit={submit} aria-label="创建账号" className="flex flex-col gap-3">
        <label className={field}>新账号用户名
          <input className={input} type="text" autoComplete="off" autoCapitalize="none" spellCheck={false}
            required minLength={3} maxLength={32} pattern="[A-Za-z0-9_\-]{3,32}" aria-describedby="username-hint"
            value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <p id="username-hint" className="text-muted text-[13px]">3–32 位字母、数字、下划线或连字符，不区分大小写。</p>
        <label className={field}>初始密码
          <input className={input} type="password" autoComplete="new-password" required minLength={10} maxLength={200}
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <p className="text-muted text-[13px]">10–200 个字符，使用者登录后可以自行修改。</p>
        {error && <p role="alert" className="text-danger text-[13px]">{error}</p>}
        {created && <p role="status" className="text-ok">{created}</p>}
        <button type="submit" className={`${btn.primary} self-start`} disabled={busy}>{busy ? '创建中…' : '创建账号'}</button>
      </form>
      {accounts.isPending && <p className="text-muted">正在加载账号…</p>}
      {accounts.isError && <p role="alert" className="text-danger">账号列表加载失败。
        <button type="button" className="underline cursor-pointer" onClick={() => accounts.refetch()}>重试</button>
      </p>}
      {accounts.data && <ul aria-label="账号列表" className="flex flex-col">
        {accounts.data.pages.flatMap((page) => page.items).map((account) => (
          <li key={account.id} className="flex flex-wrap gap-2 border-t border-line py-3">
            <span className="font-medium break-all">{account.username}</span>
            <span className="text-muted">{account.role === 'admin' ? '管理员' : '普通账号'}</span>
          </li>
        ))}
      </ul>}
      {accounts.hasNextPage && <button type="button" className={`${btn.secondary} self-start`}
        disabled={accounts.isFetchingNextPage} onClick={() => accounts.fetchNextPage()}>
        {accounts.isFetchingNextPage ? '加载中…' : '加载更多账号'}
      </button>}
    </section>
  );
}
