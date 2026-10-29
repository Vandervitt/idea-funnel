import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { btn } from '../components/ui';

export function SettingsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  return (
    <div className="flex flex-col gap-5 max-w-[640px]">
      <h1 className="text-[22px] font-bold">设置</h1>
      <section className="flex flex-col gap-2 p-5 rounded-xl bg-surface border border-line">
        <h2 className="font-bold">修改密码</h2>
        <p className="text-muted">
          密码保存在部署平台的环境变量 <code className="font-mono">PASSWORD_HASH</code> 中。在本地运行
          <code className="font-mono"> npm run hash-password </code>生成新的哈希，更新环境变量后重新部署即可。
        </p>
      </section>
      <section className="flex flex-col gap-3 p-5 rounded-xl bg-surface border border-line">
        <h2 className="font-bold">导入 / 导出</h2>
        <p className="text-muted">第二批上线。</p>
      </section>
      <button type="button" className={`${btn.secondary} self-start`} onClick={async () => {
        await api('/auth/logout', { method: 'POST' });
        qc.clear();
        navigate('/login', { replace: true });
      }}>退出登录</button>
    </div>
  );
}
