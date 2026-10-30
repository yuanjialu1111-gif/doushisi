import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, Check, ChevronLeft, ChevronRight, Coins, Dices,
  History, LoaderCircle, LogOut, RefreshCw, RotateCcw, Search, Settings2, ShieldCheck, Users, X,
} from 'lucide-react';
import {
  api, ApiError, EXPIRED_EVENT, messageOf, SESSION_KEY, type AdminUser, type AuditEntry,
  type DealPolicy, type LedgerEntry, type Pagination, type Player, type Stats,
} from './api';

const roleNames = { beans_admin: '豆子管理员', deal_admin: '发牌管理员' };
const ledgerNames: Record<string, string> = {
  admin_adjustment: '人工调整', adjustment: '人工调整', admin_credit: '管理员加豆',
  admin_debit: '管理员扣豆', room_fee: '房费', settlement: '对局结算', round_settlement: '对局结算',
  admin_add: '管理员加豆', admin_deduct: '管理员扣豆',
};
const auditNames: Record<string, string> = {
  policy_updated: '修改策略', policy_update: '修改策略', policy_changed: '修改策略',
  deal: '发牌记录', deal_selected: '选中用户', deal_triggered: '触发优化',
};

function dateText(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function balanceText(value: string) {
  const [whole, fraction] = String(value).split('.');
  const trimmed = fraction?.replace(/0+$/, '');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${trimmed ? `.${trimmed}` : ''}`;
}

function isNegative(value: string) { return value.startsWith('-') && /[1-9]/.test(value); }
function isZero(value: string) { return !/[1-9]/.test(value); }

function useDebounced(value: string) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const timeout = setTimeout(() => setDebounced(value), 250); return () => clearTimeout(timeout); }, [value]);
  return debounced;
}

function useResource<T>(path: string, revision = 0) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const reload = useCallback(() => setRetry(n => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setData(null);
    api<T>(path, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(err => {
      if (!controller.signal.aborted) setError(messageOf(err));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, revision, retry]);
  return { data, loading, error, reload };
}

function IconButton({ title, children, onClick, disabled = false }: {
  title: string; children: ReactNode; onClick: () => void; disabled?: boolean;
}) {
  return <button className="icon-button" type="button" aria-label={title} title={title} onClick={onClick} disabled={disabled}>{children}</button>;
}

function ErrorBanner({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="error-banner" role="alert"><span>{message}</span>{retry && <button type="button" className="text-button" onClick={retry}>重试</button>}</div>;
}

function Loading() { return <div className="empty-state" role="status"><LoaderCircle className="spin" size={21} /><span>正在加载</span></div>; }
function Empty({ children = '暂无记录' }: { children?: ReactNode }) { return <div className="empty-state"><History size={24} /><span>{children}</span></div>; }

function Pager({ data, onPage }: { data: Pagination; onPage: (page: number) => void }) {
  const last = Math.max(1, Math.ceil(data.total / data.pageSize));
  return <div className="pager"><span>共 {data.total} 条</span><div className="pager-actions">
    <IconButton title="上一页" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}><ChevronLeft size={17} /></IconButton>
    <span>{data.page} / {last}</span>
    <IconButton title="下一页" disabled={data.page >= last} onClick={() => onPage(data.page + 1)}><ChevronRight size={17} /></IconButton>
  </div></div>;
}

function SearchInput({ value, onChange, placeholder = '搜索账号、昵称或用户 ID' }: {
  value: string; onChange: (value: string) => void; placeholder?: string;
}) {
  return <div className="search-input"><Search size={17} /><input aria-label={placeholder} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    {value && <IconButton title="清除搜索" onClick={() => onChange('')}><X size={15} /></IconButton>}
  </div>;
}

function Modal({ title, subtitle, children, onClose, busy = false, wide = false }: {
  title: string; subtitle?: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => { document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, []);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) closeRef.current();
      if (event.key === 'Tab' && panel.current) {
        const elements = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]'));
        const first = elements[0], last = elements[elements.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy]);
  return <div className="modal-backdrop" onMouseDown={event => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={panel}>
      <div className="modal-heading"><div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton title="关闭" disabled={busy} onClick={onClose}><X size={20} /></IconButton></div>
      {children}
    </div>
  </div>;
}

function Login({ onLogin, expired }: { onLogin: (user: AdminUser) => void; expired: boolean }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await api<{ token: string; user: AdminUser }>('/login', { method: 'POST', body: JSON.stringify({ username: username.trim(), password }) });
      if (!Object.hasOwn(roleNames, response.user.role)) throw new Error('该账号没有管理员权限。');
      sessionStorage.setItem(SESSION_KEY, response.token); onLogin(response.user);
    } catch (err) { setError(messageOf(err)); } finally { setBusy(false); }
  }
  return <main className="login-page"><div className="login-brand"><Dices size={32} /><span>斗十四</span><span className="brand-divider" /><span>管理台</span></div>
    <form className="login-form" onSubmit={submit}>
      <div className="login-heading"><ShieldCheck size={28} /><h1>管理员登录</h1></div>
      {expired && !error && <ErrorBanner message="登录已过期，请重新登录。" />}
      {error && <ErrorBanner message={error} />}
      <label>管理员账号<input autoComplete="username" required maxLength={100} value={username} disabled={busy} onChange={e => setUsername(e.target.value)} /></label>
      <label>密码<input type="password" autoComplete="current-password" required maxLength={200} value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></label>
      <button className="primary-button" disabled={busy || !username.trim() || !password}>{busy ? <LoaderCircle className="spin" size={18} /> : <ArrowUpRight size={18} />}登录</button>
    </form><div className="login-footer">斗十四 · 运营管理</div>
  </main>;
}

function Statistics({ role, revision }: { role: AdminUser['role']; revision: number }) {
  const { data, error, reload } = useResource<Stats>('/stats', revision);
  const items = [
    { name: '注册用户', value: data?.users, icon: Users },
    { name: '当前在线', value: data?.online, icon: Users },
    { name: '进行中房间', value: data?.rooms, icon: Dices },
    role === 'beans_admin' ? { name: '账目记录', value: data?.ledgerEntries, icon: History } : { name: '已启用策略', value: data?.policyEnabled, icon: Settings2 },
    ...(role === 'deal_admin' ? [
      { name: '被选次数', value: data?.policySelected, icon: Users },
      { name: '触发次数', value: data?.policyTriggered, icon: Dices },
    ] : []),
  ];
  return <><div className={`statistics ${role === 'deal_admin' ? 'statistics-deal' : ''}`}>{items.map(item => <div className="stat" key={item.name}><div className="stat-label"><item.icon size={16} />{item.name}</div><strong>{item.value?.toLocaleString('zh-CN') ?? '—'}</strong></div>)}</div>{error && <ErrorBanner message={error} retry={reload} />}</>;
}

function Adjustment({ player, reference, onClose, onSaved }: { player: Player; reference?: LedgerEntry; onClose: () => void; onSaved: () => void }) {
  const [direction, setDirection] = useState<'add' | 'deduct'>(reference && !isNegative(reference.amount) && !isNegative(player.balance) && !isZero(player.balance) ? 'deduct' : 'add');
  const [amount, setAmount] = useState(reference ? reference.amount.replace(/^-/, '') : '');
  const [reason, setReason] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mutate = (action: () => void) => { action(); setRequestId(crypto.randomUUID()); setError(''); };
  const validAmount = /^\d{1,80}(?:\.\d{1,12})?$/.test(amount) && !isZero(amount);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!validAmount || !reason.trim()) return;
    setBusy(true); setError('');
    try {
      const normalizedAmount = amount.replace(/^0+(?=\d)/, '');
      await api(`/users/${encodeURIComponent(player.id)}/adjustments`, { method: 'POST', body: JSON.stringify({ amount: `${direction === 'deduct' ? '-' : ''}${normalizedAmount}`, reason: reason.trim(), requestId, referenceEntryId: reference?.id }) });
      onSaved();
    } catch (err) { setError(messageOf(err)); } finally { setBusy(false); }
  }
  return <Modal title={reference ? '追加纠错调整' : '调整豆子'} subtitle={`${player.nickname || player.username} · ${player.username}`} onClose={onClose} busy={busy}>
    <form className="modal-form" onSubmit={submit}>
      <div className="balance-summary"><span>当前余额</span><strong className={isNegative(player.balance) ? 'negative' : ''}>{balanceText(player.balance)}<small>豆</small></strong></div>
      {reference && <div className="secondary">关联原记录 <span className="mono">{reference.id}</span><br />原变动 {balanceText(reference.amount)} 豆</div>}
      <div className="segmented" aria-label="调整方向">{(['add', 'deduct'] as const).map(mode => <button type="button" key={mode} aria-pressed={direction === mode} className={direction === mode ? 'selected' : ''} disabled={busy || (mode === 'deduct' && (isNegative(player.balance) || isZero(player.balance)))} onClick={() => mutate(() => setDirection(mode))}>{mode === 'add' ? <ArrowUpRight size={17} /> : <ArrowDownLeft size={17} />}{mode === 'add' ? '增加豆子' : '扣除豆子'}</button>)}</div>
      <label>数量<input inputMode="decimal" required value={amount} disabled={busy} placeholder="0" onChange={e => mutate(() => setAmount(e.target.value.trim()))} /></label>
      <label>调整原因<textarea required maxLength={500} rows={3} value={reason} disabled={busy} onChange={e => mutate(() => setReason(e.target.value))} /></label>
      {error && <ErrorBanner message={error} />}
      <div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button className={direction === 'deduct' ? 'danger-button' : 'primary-button'} disabled={busy || !validAmount || !reason.trim()}>{busy ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}确认{direction === 'add' ? '增加' : '扣除'}</button></div>
    </form>
  </Modal>;
}

function Ledger({ player, onClose, onCorrect }: { player: Player; onClose: () => void; onCorrect: (entry: LedgerEntry, balance: string) => void }) {
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useResource<Pagination & { entries: LedgerEntry[]; balance: string }>(`/users/${encodeURIComponent(player.id)}/ledger?page=${page}`);
  return <Modal title="豆子账目" subtitle={`${player.nickname || player.username} · ${player.username} · ${player.id}`} onClose={onClose} wide>
    <div className="ledger-toolbar"><span>当前查询余额 <strong>{balanceText(data?.balance ?? player.balance)} 豆</strong></span><IconButton title="刷新账目" onClick={reload} disabled={loading}><RefreshCw size={17} /></IconButton></div>
    {error ? <ErrorBanner message={error} retry={reload} /> : loading ? <Loading /> : !data?.entries.length ? <Empty /> : <>
      <div className="table-scroll"><table><thead><tr><th>时间 / 记录</th><th>类型</th><th className="number">变动</th><th className="number">变动前</th><th className="number">变动后</th><th>操作人 / 原因</th><th>操作</th></tr></thead><tbody>{data.entries.map(entry => <tr key={entry.id}>
        <td><div>{dateText(entry.createdAt)}</div><div className="secondary mono">{entry.id}</div>{entry.roomId && <div className="secondary">房间 {entry.roomId}{entry.roundId ? ` / 局 ${entry.roundId}` : ''}</div>}</td>
        <td>{ledgerNames[entry.type] ?? entry.type}</td><td className={`number amount ${isNegative(entry.amount) ? 'negative' : 'positive'}`}>{!isNegative(entry.amount) && !isZero(entry.amount) ? '+' : ''}{balanceText(entry.amount)}</td>
        <td className="number">{balanceText(entry.balanceBefore)}</td><td className="number">{balanceText(entry.balanceAfter)}</td><td className="reason-cell"><div>{entry.actorName || '系统'}</div><div className="secondary">{entry.reason || '—'}</div>{entry.referenceEntryId && <div className="secondary mono">关联原记录 {entry.referenceEntryId}</div>}</td>
        <td><IconButton title="追加纠错调整" onClick={() => onCorrect(entry, data.balance)}><RotateCcw size={17} /></IconButton></td>
      </tr>)}</tbody></table></div><Pager data={data} onPage={setPage} />
    </>}
  </Modal>;
}

function Wallets({ onChange, revision, notify }: { onChange: () => void; revision: number; notify: (message: string) => void }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(query);
  const { data, error, loading, reload } = useResource<Pagination & { users: Player[] }>(`/users?query=${encodeURIComponent(search)}&page=${page}`, revision);
  const [adjusting, setAdjusting] = useState<(Player & { reference?: LedgerEntry }) | null>(null);
  const [ledger, setLedger] = useState<Player | null>(null);
  return <section className="workspace-section"><div className="section-toolbar"><div><h2>用户豆子</h2><span className="secondary">{data ? `${data.total} 位用户` : '账户余额与账目'}</span></div><div className="toolbar-actions"><SearchInput value={query} onChange={value => { setQuery(value); setPage(1); }} /><IconButton title="刷新用户" disabled={loading} onClick={reload}><RefreshCw size={18} /></IconButton></div></div>
    {error ? <ErrorBanner message={error} retry={reload} /> : loading ? <Loading /> : !data?.users.length ? <Empty>没有符合条件的用户</Empty> : <>
      <div className="table-scroll"><table className="wallet-table"><thead><tr><th>用户</th><th>用户 ID</th><th>状态</th><th className="number">豆子余额</th><th className="actions-cell">操作</th></tr></thead><tbody>{data.users.map(player => <tr key={player.id}>
        <td><div className="user-cell"><div className="avatar">{(player.nickname || player.username).slice(0, 1)}</div><div><strong>{player.nickname || player.username}</strong><div className="secondary">{player.username}</div></div></div></td>
        <td className="mono id-cell">{player.id}</td><td><span className={`status ${player.online ? 'online' : ''}`}><i />{player.online ? '在线' : '离线'}</span></td><td className={`number amount ${isNegative(player.balance) ? 'negative' : ''}`}>{balanceText(player.balance)}</td>
        <td><div className="row-actions"><button type="button" className="text-button" onClick={() => setLedger(player)}><History size={16} />账目</button><button type="button" className="secondary-button compact" onClick={() => setAdjusting(player)}><Coins size={16} />调整</button></div></td>
      </tr>)}</tbody></table></div><Pager data={data} onPage={setPage} />
    </>}
    {adjusting && <Adjustment player={adjusting} reference={adjusting.reference} onClose={() => setAdjusting(null)} onSaved={() => { setAdjusting(null); onChange(); notify('豆子调整已入账'); }} />}
    {ledger && <Ledger player={ledger} onClose={() => setLedger(null)} onCorrect={(reference, balance) => { setAdjusting({ ...ledger, balance, reference }); setLedger(null); }} />}
  </section>;
}

function PolicyEditor({ policy, onClose, onSaved, onConflict }: { policy: DealPolicy; onClose: () => void; onSaved: () => void; onConflict: () => void }) {
  const [enabled, setEnabled] = useState(policy.enabled);
  const [probability, setProbability] = useState(String(policy.probability));
  const [reason, setReason] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const validProbability = /^\d{1,3}(?:\.\d{1,2})?$/.test(probability) && Number(probability) >= 0 && Number(probability) <= 100;
  const mutate = (action: () => void) => { action(); setRequestId(crypto.randomUUID()); if (!conflict) setError(''); };
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!validProbability || conflict || !reason.trim()) return;
    setBusy(true); setError('');
    try {
      await api(`/deal-policies/${encodeURIComponent(policy.userId)}`, { method: 'PUT', body: JSON.stringify({ enabled, probability: Number(probability), reason: reason.trim(), requestId, expectedVersion: policy.version }) });
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) { setConflict(true); setError('策略已更新，请关闭窗口并重新打开最新策略。'); onConflict(); }
      else setError(messageOf(err));
    } finally { setBusy(false); }
  }
  return <Modal title="发牌策略" subtitle={`${policy.nickname || policy.username} · ${policy.username}`} busy={busy} onClose={onClose}>
    <form className="modal-form" onSubmit={submit}>
      <label className="switch-row"><span>启用策略</span><input type="checkbox" role="switch" checked={enabled} disabled={busy || conflict} onChange={e => mutate(() => setEnabled(e.target.checked))} /><span className="switch-track" aria-hidden="true" /></label>
      <div className="probability-heading"><label htmlFor="probability-number">优化触发概率</label><div className="number-input"><input id="probability-number" type="number" min={0} max={100} step="0.01" value={probability} disabled={busy || conflict} onChange={e => mutate(() => setProbability(e.target.value))} /><span>%</span></div></div>
      <input className="probability-slider" aria-label="优化触发概率" type="range" min={0} max={100} step={1} value={validProbability ? probability : 0} disabled={busy || conflict} onChange={e => mutate(() => setProbability(e.target.value))} />
      <div className="range-labels"><span>0%</span><span>50%</span><span>100%</span></div>
      <label>修改原因<textarea required rows={3} maxLength={500} value={reason} disabled={busy || conflict} onChange={e => mutate(() => setReason(e.target.value))} /></label>
      <div className="secondary">版本 {policy.version} · {dateText(policy.updatedAt)}</div>
      {error && <ErrorBanner message={error} />}
      <div className="modal-actions"><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={busy || conflict || !validProbability || !reason.trim()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}保存策略</button></div>
    </form>
  </Modal>;
}

function Policies({ revision, onChange, notify }: { revision: number; onChange: () => void; notify: (message: string) => void }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(query);
  const { data, error, loading, reload } = useResource<Pagination & { policies: DealPolicy[] }>(`/deal-policies?query=${encodeURIComponent(search)}&page=${page}`, revision);
  const [editing, setEditing] = useState<DealPolicy | null>(null);
  return <section className="workspace-section"><div className="section-toolbar"><div><h2>发牌策略</h2><span className="secondary">{data ? `${data.total} 位用户` : '用户策略'}</span></div><div className="toolbar-actions"><SearchInput value={query} onChange={value => { setQuery(value); setPage(1); }} /><IconButton title="刷新策略" disabled={loading} onClick={reload}><RefreshCw size={18} /></IconButton></div></div>
    {error ? <ErrorBanner message={error} retry={reload} /> : loading ? <Loading /> : !data?.policies.length ? <Empty>没有符合条件的用户</Empty> : <>
      <div className="table-scroll"><table><thead><tr><th>用户</th><th>用户 ID</th><th>策略状态</th><th className="number">触发概率</th><th>更新时间</th><th className="actions-cell">操作</th></tr></thead><tbody>{data.policies.map(policy => <tr key={policy.userId}>
        <td><div className="user-cell"><div className="avatar">{(policy.nickname || policy.username).slice(0, 1)}</div><div><strong>{policy.nickname || policy.username}</strong><div className="secondary">{policy.username}</div></div></div></td><td className="mono id-cell">{policy.userId}</td>
        <td><span className={`status ${policy.enabled ? 'online' : ''}`}><i />{policy.enabled ? '已启用' : '未启用'}</span></td><td className="number amount">{policy.probability}%</td><td>{dateText(policy.updatedAt)}<div className="secondary">版本 {policy.version}</div></td><td><div className="row-actions"><button className="secondary-button compact" type="button" onClick={() => setEditing(policy)}><Settings2 size={16} />编辑</button></div></td>
      </tr>)}</tbody></table></div><Pager data={data} onPage={setPage} />
    </>}
    {editing && <PolicyEditor policy={editing} onClose={() => setEditing(null)} onConflict={reload} onSaved={() => { setEditing(null); onChange(); notify('发牌策略已保存'); }} />}
  </section>;
}

function AuditDetails({ details }: { details: unknown }) {
  if (details === null || details === undefined) return <span className="secondary">—</span>;
  if (typeof details !== 'object' || Array.isArray(details)) return <span>{String(details)}</span>;
  const fields = details as Record<string, unknown>;
  const labels: Record<string, string> = {
    reason: '原因', roomId: '房间', roundId: '局次', selectedUserId: '选中用户',
    triggered: '触发优化', probability: '触发概率', version: '策略版本',
    candidates: '候选牌数', evaluation: '起手评估', selectedCount: '被选次数',
    triggeredCount: '触发次数',
  };
  const before = fields.before as { enabled?: boolean; probability?: number; version?: number } | undefined;
  const after = fields.after as { enabled?: boolean; probability?: number; version?: number } | undefined;
  return <div className="audit-values">
    {before && after && <><div><span>策略状态</span><strong>{before.enabled ? '启用' : '关闭'} → {after.enabled ? '启用' : '关闭'}</strong></div><div><span>触发概率</span><strong>{before.probability}% → {after.probability}%</strong></div><div><span>策略版本</span><strong>{before.version} → {after.version}</strong></div></>}
    {Object.entries(fields).filter(([key]) => key !== 'before' && key !== 'after').map(([key, value]) => <div key={key}><span>{labels[key] ?? key}</span><strong>{value === null ? '—' : typeof value === 'boolean' ? value ? '是' : '否' : typeof value === 'object' ? JSON.stringify(value) : `${String(value)}${key === 'probability' ? '%' : ''}`}</strong></div>)}
  </div>;
}

function Audit({ revision }: { revision: number }) {
  const [userId, setUserId] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(userId);
  const { data, error, loading, reload } = useResource<Pagination & { entries: AuditEntry[] }>(`/deal-audit?page=${page}${search ? `&userId=${encodeURIComponent(search)}` : ''}`, revision);
  return <section className="workspace-section"><div className="section-toolbar"><div><h2>策略审计</h2><span className="secondary">{data ? `${data.total} 条记录` : '变更与发牌记录'}</span></div><div className="toolbar-actions"><SearchInput value={userId} placeholder="按完整用户 ID 筛选" onChange={value => { setUserId(value); setPage(1); }} /><IconButton title="刷新审计" disabled={loading} onClick={reload}><RefreshCw size={18} /></IconButton></div></div>
    {error ? <ErrorBanner message={error} retry={reload} /> : loading ? <Loading /> : !data?.entries.length ? <Empty /> : <>
      <div className="table-scroll"><table><thead><tr><th>时间 / 记录</th><th>事件</th><th>用户 ID</th><th>操作人</th><th>详情</th></tr></thead><tbody>{data.entries.map(entry => <tr key={entry.id}>
        <td>{dateText(entry.createdAt)}<div className="secondary mono">{entry.id}</div></td><td>{auditNames[entry.kind] ?? entry.kind}</td><td className="mono id-cell">{entry.userId || '—'}</td><td>{entry.actorName || '系统'}</td><td className="audit-details"><AuditDetails details={entry.details} /></td>
      </tr>)}</tbody></table></div><Pager data={data} onPage={setPage} />
    </>}
  </section>;
}

export default function App() {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [checking, setChecking] = useState(!!sessionStorage.getItem(SESSION_KEY));
  const [sessionError, setSessionError] = useState('');
  const [sessionRetry, setSessionRetry] = useState(0);
  const [expired, setExpired] = useState(false);
  const [view, setView] = useState<'main' | 'audit'>('main');
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const onExpired = () => { setUser(null); setChecking(false); setExpired(true); setSessionError(''); setView('main'); };
    window.addEventListener(EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(EXPIRED_EVENT, onExpired);
  }, []);
  useEffect(() => {
    if (!sessionStorage.getItem(SESSION_KEY)) { setChecking(false); return; }
    const controller = new AbortController(); setChecking(true); setSessionError('');
    api<{ user: AdminUser }>('/me', { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      if (!Object.hasOwn(roleNames, result.user.role)) { sessionStorage.removeItem(SESSION_KEY); throw new Error('该账号没有管理员权限。'); }
      setUser(result.user);
    }).catch(error => { if (!controller.signal.aborted && !(error instanceof ApiError && error.status === 401)) setSessionError(messageOf(error)); })
      .finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, [sessionRetry]);
  useEffect(() => { if (!notice) return; const timeout = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(timeout); }, [notice]);
  async function logout() {
    try {
      if (sessionStorage.getItem(SESSION_KEY)) await api('/logout', { method: 'POST' });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) { setNotice('退出登录失败，请稍后重试。'); return; }
    }
    sessionStorage.removeItem(SESSION_KEY); setUser(null); setView('main'); setExpired(false); setNotice('');
  }
  if (checking) return <main className="session-page"><Loading /></main>;
  if (sessionError && !user) return <main className="session-page"><ErrorBanner message={sessionError} retry={() => setSessionRetry(value => value + 1)} /><button className="secondary-button" onClick={() => { logout(); setSessionError(''); }}>返回登录</button></main>;
  if (!user) return <Login expired={expired} onLogin={value => { setUser(value); setExpired(false); setRevision(n => n + 1); }} />;
  const isBeans = user.role === 'beans_admin';
  const changed = () => setRevision(value => value + 1);
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><Dices size={28} /><div><strong>斗十四</strong><span>运营管理台</span></div></div>
    <div className="nav-label">工作空间</div><nav aria-label="管理导航"><button className={view === 'main' ? 'active' : ''} onClick={() => setView('main')}>{isBeans ? <Coins size={19} /> : <Settings2 size={19} />}{isBeans ? '用户豆子' : '发牌策略'}</button>{!isBeans && <button className={view === 'audit' ? 'active' : ''} onClick={() => setView('audit')}><History size={19} />策略审计</button>}</nav>
    <div className="sidebar-bottom"><ShieldCheck size={17} /><span>{roleNames[user.role]}</span></div>
  </aside><div className="main-column"><header className="topbar"><div className="breadcrumbs"><span>管理台</span><ChevronRight size={14} /><strong>{isBeans ? '用户豆子' : view === 'audit' ? '策略审计' : '发牌策略'}</strong></div><div className="account-menu"><span>{user.nickname || user.username}</span><IconButton title="退出登录" onClick={logout}><LogOut size={18} /></IconButton></div></header>
    <main className="main-content"><div className="page-heading"><div><div className="eyebrow">{roleNames[user.role]}</div><h1>{isBeans ? '豆子管理' : '发牌管理'}</h1></div><IconButton title="刷新全部数据" onClick={changed}><RefreshCw size={18} /></IconButton></div><Statistics role={user.role} revision={revision} />
      {isBeans ? <Wallets revision={revision} onChange={changed} notify={setNotice} /> : view === 'main' ? <Policies revision={revision} onChange={changed} notify={setNotice} /> : <Audit revision={revision} />}
    </main><footer className="page-footer"><span>斗十四 · 管理台</span><span>{roleNames[user.role]}</span></footer>
  </div>{notice && <div className="toast" role="status"><Check size={18} />{notice}<IconButton title="关闭通知" onClick={() => setNotice('')}><X size={16} /></IconButton></div>}</div>;
}
