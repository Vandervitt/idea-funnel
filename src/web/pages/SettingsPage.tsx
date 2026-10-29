import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, useImport } from '../api';
import { parseBatch } from '../../shared/capture';
import type { ImportResult } from '../../shared/types';
import { TagChip, btn, useToast } from '../components/ui';

const section = 'flex flex-col gap-3 p-5 rounded-xl bg-surface border border-line';
const PREVIEW_ROWS = 50;

const summary = (r: ImportResult) => `新增 ${r.inserted} 条${r.skipped ? `，跳过 ${r.skipped} 条（库里已有）` : ''}`;

export function SettingsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  return (
    <div className="flex flex-col gap-5 max-w-[640px]">
      <h1 className="text-[22px] font-bold">设置</h1>
      <section aria-labelledby="export-title" className={section}>
        <h2 id="export-title" className="font-bold">导出</h2>
        <p className="text-muted">JSON 包含全部想法、标签和时间线，可以原样导回；Markdown 方便阅读和归档。</p>
        <div className="flex flex-wrap gap-2.5">
          <a href="/api/export?format=json" download className={`${btn.secondary} no-underline`}>导出 JSON</a>
          <a href="/api/export?format=md" download className={`${btn.secondary} no-underline`}>导出 Markdown</a>
        </div>
      </section>
      <JsonImport />
      <BatchImport />
      <section className={section}>
        <h2 className="font-bold">修改密码</h2>
        <p className="text-muted">
          密码保存在部署平台的环境变量 <code className="font-mono">PASSWORD_HASH</code> 中。在本地运行
          <code className="font-mono"> npm run hash-password </code>生成新的哈希，更新环境变量后重新部署即可。
        </p>
      </section>
      <button type="button" className={`${btn.secondary} self-start`} onClick={async () => {
        await api('/auth/logout', { method: 'POST' });
        qc.clear();
        navigate('/login', { replace: true });
      }}>退出登录</button>
    </div>
  );
}

const errorText = (err: unknown) =>
  err instanceof ApiError
    ? err.status === 400 ? '文件内容不符合导出格式，没有导入任何数据' : err.message
    : '导入失败，请重试';

function JsonImport() {
  const importer = useImport();
  const toast = useToast();
  const [result, setResult] = useState<string | null>(null);

  async function onFile(file: File) {
    setResult(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      toast('不是有效的 JSON 文件', 'error');
      return;
    }
    try {
      const r = await importer.mutateAsync({ kind: 'json', file: parsed });
      setResult(`导入完成：${summary(r)}`);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  return (
    <section aria-labelledby="json-import-title" className={section}>
      <h2 id="json-import-title" className="font-bold">从 JSON 恢复</h2>
      <p className="text-muted">选择之前导出的 JSON 文件。库里已有的想法会跳过，重复导入同一个文件是安全的。</p>
      <label className={`${btn.secondary} self-start`}>
        选择导出文件
        <input type="file" accept="application/json,.json" className="sr-only" disabled={importer.isPending}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void onFile(f);
          }} />
      </label>
      {result && <p role="status" className="text-ok">{result}</p>}
    </section>
  );
}

function BatchImport() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const importer = useImport();
  const toast = useToast();
  const { items, errors } = parseBatch(text);

  async function submit() {
    try {
      const r = await importer.mutateAsync({ kind: 'lines', items: items.map(({ title, tags }) => ({ title, tags })) });
      setText('');
      setResult(`已导入到收集箱：${summary(r)}`);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  return (
    <section aria-labelledby="batch-title" className={section}>
      <h2 id="batch-title" className="font-bold">批量导入</h2>
      <label htmlFor="batch-text" className="text-muted">每行一条想法，可以用 #标签 分类，导入到收集箱。一次最多 500 条。</label>
      <textarea id="batch-text" rows={6} value={text} onChange={(e) => { setText(e.target.value); setResult(null); }}
        placeholder={'记账小程序 #工具\n播客搜索 #AI'}
        className="p-3 rounded-lg border border-line-strong bg-surface text-ink placeholder:text-muted outline-none focus:border-accent font-sans" />
      {text.trim() && (
        <div className="flex flex-col gap-2" aria-label="导入预览" role="region">
          <p className="text-ink-2">将会导入 <b>{items.length}</b> 条{errors.length ? `，${errors.length} 行无法导入` : ''}</p>
          {items.length > 0 && (
            <ul className="flex flex-col max-h-64 overflow-y-auto px-3 rounded-lg bg-sunken">
              {items.slice(0, PREVIEW_ROWS).map((i) => (
                <li key={i.line} className="flex flex-wrap items-center gap-2 py-2 border-t border-line first:border-t-0">
                  <span className="font-medium break-all">{i.title}</span>
                  {i.tags.map((t) => <TagChip key={t} name={t} />)}
                </li>
              ))}
              {items.length > PREVIEW_ROWS && <li className="py-2 text-muted">还有 {items.length - PREVIEW_ROWS} 条…</li>}
            </ul>
          )}
          {errors.length > 0 && (
            <ul className="flex flex-col gap-1 text-[13px] text-danger">
              {errors.slice(0, 10).map((e) => <li key={e.line}>第 {e.line} 行：{e.reason}</li>)}
              {errors.length > 10 && <li>还有 {errors.length - 10} 行…</li>}
            </ul>
          )}
        </div>
      )}
      <button type="button" className={`${btn.primary} self-start`} disabled={!items.length || importer.isPending} onClick={submit}>
        {items.length ? `导入 ${items.length} 条` : '导入'}
      </button>
      {result && <p role="status" className="text-ok">{result}</p>}
    </section>
  );
}
