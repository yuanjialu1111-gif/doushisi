import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, Ban, Check, ChevronLeft, ChevronRight, Coins, Dices, History, ImageOff, Images,
  LayoutGrid, LoaderCircle, LogOut, Plus, RefreshCw, RotateCcw, Search, Settings2, ShieldCheck, Users, UserX, X,
} from 'lucide-react';
import {
  api, ApiError, EXPIRED_EVENT, isMissingEndpoint, mediaUrl, messageOf, MISSING_ENDPOINT, SESSION_KEY,
  type AdminUser, type AuditEntry, type AvatarItem, type DealPolicy, type LedgerEntry, type LobbyTemplate,
  type LobbyVariant, type Pagination, type Player, type Stats,
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
  const [missing, setMissing] = useState(false);
  const [retry, setRetry] = useState(0);
  const reload = useCallback(() => setRetry(n => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setMissing(false); setData(null);
    api<T>(path, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(err => {
      if (!controller.signal.aborted) { setError(messageOf(err)); setMissing(isMissingEndpoint(err)); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, revision, retry]);
  return { data, loading, error, missing, reload };
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

// 头像缩略图：被驳回或没传时服务端会跳到默认灰头像；图片加载失败（如本地 vite 未代理 /media）时退回首字。
function Avatar({ url, name, alt = '' }: { url?: string; name: string; alt?: string }) {
  const src = mediaUrl(url);
  const [failed, setFailed] = useState('');
  return <div className="avatar">{src && failed !== src ? <img src={src} alt={alt} loading="lazy" onError={() => setFailed(src)} /> : name.slice(0, 1)}</div>;
}

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
        const elements = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'));
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

// 驳回头像 / 昵称（R9）：原因 1–200 字，服务端留审计记录；两种管理员都能操作。
interface RejectTarget { kind: 'avatar' | 'nickname'; userId: string; username: string; nickname: string; avatarUrl?: string }

function Rejection({ target, onClose, onSaved }: { target: RejectTarget; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isAvatar = target.kind === 'avatar';
  const name = target.nickname || target.username;
  const validReason = reason.trim().length >= 1 && reason.trim().length <= 200;
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!validReason) return;
    setBusy(true); setError('');
    try {
      await api(`/users/${encodeURIComponent(target.userId)}/${isAvatar ? 'avatar' : 'nickname'}-rejection`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) });
      onSaved();
    } catch (err) { setError(messageOf(err)); } finally { setBusy(false); }
  }
  return <Modal title={isAvatar ? '驳回头像' : '驳回昵称'} subtitle={`${name} · ${target.username}`} onClose={onClose} busy={busy}>
    <form className="modal-form" onSubmit={submit}>
      <div className="user-cell"><Avatar url={target.avatarUrl} name={name} alt={`${name} 的头像`} /><div><strong>{target.nickname || '未设置昵称'}</strong><div className="secondary">{isAvatar ? '驳回后头像变回默认灰色头像，玩家下次登录要重新上传。' : '驳回后玩家下次登录要重新填写昵称。'}</div></div></div>
      <label>驳回原因<textarea required maxLength={200} rows={3} value={reason} disabled={busy} placeholder="1–200 字" onChange={e => { setReason(e.target.value); setError(''); }} /></label>
      {error && <ErrorBanner message={error} />}
      <div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button className="danger-button" disabled={busy || !validReason}>{busy ? <LoaderCircle size={17} className="spin" /> : <Ban size={17} />}确认驳回</button></div>
    </form>
  </Modal>;
}

function Wallets({ onChange, revision, notify }: { onChange: () => void; revision: number; notify: (message: string) => void }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(query);
  const { data, error, loading, reload } = useResource<Pagination & { users: Player[] }>(`/users?query=${encodeURIComponent(search)}&page=${page}`, revision);
  const [adjusting, setAdjusting] = useState<(Player & { reference?: LedgerEntry }) | null>(null);
  const [ledger, setLedger] = useState<Player | null>(null);
  const [rejecting, setRejecting] = useState<RejectTarget | null>(null);
  const reject = (kind: RejectTarget['kind'], player: Player) => setRejecting({ kind, userId: player.id, username: player.username, nickname: player.nickname, avatarUrl: player.avatarUrl });
  return <section className="workspace-section"><div className="section-toolbar"><div><h2>用户豆子</h2><span className="secondary">{data ? `${data.total} 位用户` : '账户余额与账目'}</span></div><div className="toolbar-actions"><SearchInput value={query} onChange={value => { setQuery(value); setPage(1); }} /><IconButton title="刷新用户" disabled={loading} onClick={reload}><RefreshCw size={18} /></IconButton></div></div>
    {error ? <ErrorBanner message={error} retry={reload} /> : loading ? <Loading /> : !data?.users.length ? <Empty>没有符合条件的用户</Empty> : <>
      <div className="table-scroll"><table className="wallet-table"><thead><tr><th>头像</th><th>用户</th><th>用户 ID</th><th>状态</th><th className="number">豆子余额</th><th className="actions-cell">操作</th></tr></thead><tbody>{data.users.map(player => <tr key={player.id}>
        <td><Avatar url={player.avatarUrl} name={player.nickname || player.username} alt={`${player.nickname || player.username} 的头像`} />{player.avatarStatus === 'rejected' && <div className="secondary negative">已驳回</div>}</td>
        <td><div className="user-cell"><div><strong>{player.nickname || player.username}</strong><div className="secondary">{player.username}</div>{player.nicknameRejected && <div className="secondary negative">昵称已驳回</div>}</div></div></td>
        <td className="mono id-cell">{player.id}</td><td><span className={`status ${player.online ? 'online' : ''}`}><i />{player.online ? '在线' : '离线'}</span></td><td className={`number amount ${isNegative(player.balance) ? 'negative' : ''}`}>{balanceText(player.balance)}</td>
        <td><div className="row-actions"><button type="button" className="text-button" onClick={() => setLedger(player)}><History size={16} />账目</button>
          <button type="button" className="text-button" disabled={!(player.avatarStatus === 'active' && player.avatarHash)} onClick={() => reject('avatar', player)}><ImageOff size={16} />驳回头像</button>
          <button type="button" className="text-button" disabled={!!player.nicknameRejected} onClick={() => reject('nickname', player)}><UserX size={16} />驳回昵称</button>
          <button type="button" className="secondary-button compact" onClick={() => setAdjusting(player)}><Coins size={16} />调整</button></div></td>
      </tr>)}</tbody></table></div><Pager data={data} onPage={setPage} />
    </>}
    {adjusting && <Adjustment player={adjusting} reference={adjusting.reference} onClose={() => setAdjusting(null)} onSaved={() => { setAdjusting(null); onChange(); notify('豆子调整已入账'); }} />}
    {ledger && <Ledger player={ledger} onClose={() => setLedger(null)} onCorrect={(reference, balance) => { setAdjusting({ ...ledger, balance, reference }); setLedger(null); }} />}
    {rejecting && <Rejection target={rejecting} onClose={() => setRejecting(null)} onSaved={() => { setRejecting(null); onChange(); notify(rejecting.kind === 'avatar' ? '头像已驳回' : '昵称已驳回'); }} />}
  </section>;
}

// 头像审核（R9）：最近上传的头像，两种管理员都能看、都能驳回头像或昵称。
const avatarStatusNames: Record<string, string> = { active: '使用中', rejected: '已驳回' };

function AvatarReview({ revision, onChange, notify }: { revision: number; onChange: () => void; notify: (message: string) => void }) {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useResource<Pagination & { items: AvatarItem[] }>(`/avatars?page=${page}`, revision);
  const [rejecting, setRejecting] = useState<RejectTarget | null>(null);
  const reject = (kind: RejectTarget['kind'], item: AvatarItem) => setRejecting({ kind, userId: item.userId, username: item.username, nickname: item.nickname, avatarUrl: item.avatarUrl });
  return <section className="workspace-section"><div className="section-toolbar"><div><h2>头像审核</h2><span className="secondary">{data ? `${data.total} 张头像` : '最近上传的头像'}</span></div><div className="toolbar-actions"><IconButton title="刷新头像" disabled={loading} onClick={reload}><RefreshCw size={18} /></IconButton></div></div>
    {error ? <ErrorBanner message={error} retry={reload} /> : loading ? <Loading /> : !data?.items?.length ? <Empty>还没有玩家上传头像</Empty> : <>
      <div className="avatar-grid">{data.items.map(item => {
        const name = item.nickname || item.username;
        return <div className="avatar-card" key={item.userId}>
          <Avatar url={item.avatarUrl} name={name} alt={`${name} 的头像`} />
          <div><strong>{name}</strong>{item.nicknameRejected && <div className="secondary negative">昵称已驳回</div>}<div className="secondary">{item.username}</div><div className="secondary">上传于 {dateText(item.uploadedAt)}</div></div>
          <span className={`status ${item.avatarStatus === 'active' ? 'online' : ''}`}><i />{avatarStatusNames[item.avatarStatus] ?? item.avatarStatus}</span>
          <div className="row-actions"><button type="button" className="text-button" disabled={!(item.avatarStatus === 'active' && item.avatarHash)} onClick={() => reject('avatar', item)}><ImageOff size={16} />驳回头像</button>
            <button type="button" className="text-button" disabled={item.nicknameRejected} onClick={() => reject('nickname', item)}><UserX size={16} />驳回昵称</button></div>
        </div>;
      })}</div><Pager data={data} onPage={setPage} />
    </>}
    {rejecting && <Rejection target={rejecting} onClose={() => setRejecting(null)} onSaved={() => { setRejecting(null); onChange(); notify(rejecting.kind === 'avatar' ? '头像已驳回' : '昵称已驳回'); }} />}
  </section>;
}

// 大厅桌模板（R2）：只给豆子管理员。不提供删除，停用用 enabled=false。
// options 与玩家开房同形；需要手填底分的玩法写 options.baseBeans（字符串），需要手选人数的写 options.playerNum。
type OptionsResult = { options: Record<string, unknown>; error: '' } | { options: null; error: string };

function parseOptions(text: string): OptionsResult {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { options: null, error: 'options 必须是 JSON 对象（用 { } 包起来）。' };
    return { options: value as Record<string, unknown>, error: '' };
  } catch (err) { return { options: null, error: `options 不是合法的 JSON：${messageOf(err)}` }; }
}

const optionsText = (options: Record<string, unknown> = {}) => JSON.stringify(options, null, 2);
const isIntegerIn = (value: string, min: number, max: number) => /^-?\d+$/.test(value) && Number(value) >= min && Number(value) <= max;

function NumberField({ label, value, onChange, min, max, unit, disabled }: {
  label: string; value: string; onChange: (value: string) => void; min: number; max: number; unit?: string; disabled: boolean;
}) {
  const id = useId();
  return <div className="probability-heading"><label htmlFor={id}>{label}</label><div className="number-input"><input id={id} type="number" min={min} max={max} step={1} required value={value} disabled={disabled} onChange={e => onChange(e.target.value.trim())} />{unit && <span>{unit}</span>}</div></div>;
}

function TemplateEditor({ template, variants, nextSortOrder, onClose, onSaved }: {
  template: LobbyTemplate | null; variants: LobbyVariant[]; nextSortOrder: number; onClose: () => void; onSaved: () => void;
}) {
  const [variantKey, setVariantKey] = useState(template?.variantKey ?? variants[0]?.key ?? '');
  const [text, setText] = useState(() => optionsText(template?.options ?? variants.find(v => v.key === variantKey)?.defaults));
  const [standingEmpty, setStandingEmpty] = useState(String(template?.standingEmpty ?? 3));
  const [thresholdMultiplier, setThresholdMultiplier] = useState(String(template?.thresholdMultiplier ?? 10));
  const [idleClearMinutes, setIdleClearMinutes] = useState(String(template?.idleClearMinutes ?? 10));
  const [sortOrder, setSortOrder] = useState(String(template?.sortOrder ?? nextSortOrder));
  const [enabled, setEnabled] = useState(template?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mutate = (action: () => void) => { action(); setError(''); };
  const variant = variants.find(v => v.key === variantKey);
  const parsed = parseOptions(text);
  const options = parsed.options;
  // 底分、人数两个输入框直接改 JSON 里的字段，管理员看到的就是要提交的 options。
  const setOption = (key: string, value: unknown) => { if (options) mutate(() => setText(optionsText({ ...options, [key]: value }))); };
  const baseBeans = typeof options?.baseBeans === 'string' ? options.baseBeans : options?.baseBeans === undefined ? '' : String(options.baseBeans);
  const problem = !variantKey ? '请选择玩法。'
    : !options ? ''
    : variant?.needsBaseBeans && !(typeof options.baseBeans === 'string' && /^(?:0|[1-9]\d{0,79})(?:\.\d{1,12})?$/.test(options.baseBeans) && /[1-9]/.test(options.baseBeans)) ? '底分要填大于 0 的数，最多 12 位小数。'
    : variant && !variant.needsBaseBeans && options.baseBeans !== undefined ? '这个玩法用原版底分，请从 options 里去掉 baseBeans。'
    : variant?.needsPlayerNum && ![2, 3, 4].includes(options.playerNum as number) ? '请选择人数。'
    : !isIntegerIn(standingEmpty, 0, 20) ? '常驻空桌要填 0–20 的整数。'
    : !isIntegerIn(thresholdMultiplier, 1, 1000) ? '门槛倍数要填 1–1000 的整数。'
    : !isIntegerIn(idleClearMinutes, 1, 120) ? '清座时限要填 1–120 的整数。'
    : !isIntegerIn(sortOrder, -999999, 999999) ? '排序要填整数。' : '';
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!options || problem) return;
    setBusy(true); setError('');
    try {
      const body = { variantKey, options, standingEmpty: Number(standingEmpty), thresholdMultiplier: Number(thresholdMultiplier), idleClearMinutes: Number(idleClearMinutes), enabled, sortOrder: Number(sortOrder) };
      await api(template ? `/lobby-templates/${encodeURIComponent(template.id)}` : '/lobby-templates', { method: template ? 'PUT' : 'POST', body: JSON.stringify(body) });
      onSaved();
    } catch (err) { setError(isMissingEndpoint(err) ? MISSING_ENDPOINT : messageOf(err)); } finally { setBusy(false); }
  }
  return <Modal title={template ? '编辑大厅桌模板' : '新建大厅桌模板'} subtitle={template ? `${template.variantName || template.variantKey} · ${template.id}` : '按模板常驻空桌，玩家点桌入座'} onClose={onClose} busy={busy}>
    <form className="modal-form" onSubmit={submit}>
      <label>玩法<select aria-label="玩法" value={variantKey} disabled={busy} onChange={e => { const key = e.target.value; mutate(() => { setVariantKey(key); setText(optionsText(variants.find(v => v.key === key)?.defaults)); }); }}>
        {!variantKey && <option value="">请选择玩法</option>}
        {variants.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}
        {template && !variants.some(item => item.key === template.variantKey) && <option value={template.variantKey}>{template.variantName || template.variantKey}</option>}
      </select></label>
      {variant?.needsBaseBeans && <label>底分<input inputMode="decimal" required value={baseBeans} disabled={busy || !options} placeholder="例如 1" onChange={e => setOption('baseBeans', e.target.value.trim())} /></label>}
      {variant?.needsPlayerNum && <div className="segmented" role="group" aria-label="人数">{[2, 3, 4].map(count => <button type="button" key={count} aria-pressed={options?.playerNum === count} className={options?.playerNum === count ? 'selected' : ''} disabled={busy || !options} onClick={() => setOption('playerNum', count)}><Users size={17} />{count} 人</button>)}</div>}
      <label>玩法选项（options JSON）<textarea className="mono" rows={8} spellCheck={false} aria-invalid={!!parsed.error} value={text} disabled={busy} onChange={e => mutate(() => setText(e.target.value))} />{parsed.error && <span className="secondary negative">{parsed.error}</span>}</label>
      <NumberField label="常驻空桌（0–20）" value={standingEmpty} min={0} max={20} unit="张" disabled={busy} onChange={value => mutate(() => setStandingEmpty(value))} />
      <NumberField label="入座门槛倍数（1–1000）" value={thresholdMultiplier} min={1} max={1000} unit="倍" disabled={busy} onChange={value => mutate(() => setThresholdMultiplier(value))} />
      <NumberField label="清座时限（1–120）" value={idleClearMinutes} min={1} max={120} unit="分钟" disabled={busy} onChange={value => mutate(() => setIdleClearMinutes(value))} />
      <NumberField label="排序（小的在前）" value={sortOrder} min={-999999} max={999999} disabled={busy} onChange={value => mutate(() => setSortOrder(value))} />
      <label className="switch-row"><span>启用模板</span><input type="checkbox" role="switch" checked={enabled} disabled={busy} onChange={e => mutate(() => setEnabled(e.target.checked))} /><span className="switch-track" aria-hidden="true" /></label>
      {problem && <div className="secondary negative">{problem}</div>}
      {error && <ErrorBanner message={error} />}
      <div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={busy || !options || !!problem}>{busy ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}保存模板</button></div>
    </form>
  </Modal>;
}

function LobbyTemplates({ revision, onChange, notify }: { revision: number; onChange: () => void; notify: (message: string) => void }) {
  const { data, error, missing, loading, reload } = useResource<{ templates: LobbyTemplate[]; variants: LobbyVariant[] }>('/lobby-templates', revision);
  const [editing, setEditing] = useState<LobbyTemplate | 'new' | null>(null);
  const templates = data?.templates ?? [], variants = data?.variants ?? [];
  return <section className="workspace-section"><div className="section-toolbar"><div><h2>大厅桌模板</h2><span className="secondary">{data ? `${templates.length} 个模板` : '系统常驻桌配置'}</span></div><div className="toolbar-actions"><button type="button" className="primary-button compact" disabled={!variants.length} onClick={() => setEditing('new')}><Plus size={16} />新建模板</button><IconButton title="刷新模板" disabled={loading} onClick={reload}><RefreshCw size={18} /></IconButton></div></div>
    {error ? <ErrorBanner message={missing ? MISSING_ENDPOINT : error} retry={reload} /> : loading ? <Loading /> : !templates.length ? <Empty>还没有大厅桌模板</Empty> : <>
      <div className="table-scroll"><table><thead><tr><th>玩法</th><th className="number">底分 / 人数 / 局数</th><th className="number">常驻空桌</th><th className="number">门槛倍数</th><th className="number">清座时限</th><th>状态</th><th className="number">排序</th><th className="number">当前桌况</th><th className="actions-cell">操作</th></tr></thead><tbody>{templates.map(template => <tr key={template.id}>
        <td><strong>{template.variantName || template.variantKey}</strong><div className="secondary mono">{template.variantKey}</div></td>
        <td className="number">{template.summary ? `${balanceText(template.summary.baseBeans)} / ${template.summary.playerNum} 人 / ${template.summary.rounds} 局` : '—'}</td>
        <td className="number">{template.standingEmpty} 张</td><td className="number">{template.thresholdMultiplier} 倍</td><td className="number">{template.idleClearMinutes} 分钟</td>
        <td><span className={`status ${template.enabled ? 'online' : ''}`}><i />{template.enabled ? '已启用' : '已停用'}</span></td><td className="number">{template.sortOrder}</td>
        <td className="number">{template.openTables} 桌 · {template.seatedPlayers} 人</td>
        <td><div className="row-actions"><button type="button" className="secondary-button compact" onClick={() => setEditing(template)}><Settings2 size={16} />编辑</button></div></td>
      </tr>)}</tbody></table></div>
    </>}
    {editing && <TemplateEditor template={editing === 'new' ? null : editing} variants={variants} nextSortOrder={templates.reduce((max, item) => Math.max(max, item.sortOrder + 1), 0)} onClose={() => setEditing(null)} onSaved={() => { const created = editing === 'new'; setEditing(null); onChange(); notify(created ? '大厅桌模板已新建' : '大厅桌模板已保存'); }} />}
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
      <div className="secondary">版本 {policy.version} · {dateText(policy.updatedAt)} · 保存后从下一局开始生效</div>
      {enabled && validProbability && Number(probability) === 0 && <div className="secondary">概率 0% 时这一条不会参与发牌优化，只是保持启用状态。</div>}
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
  const [view, setView] = useState<'main' | 'audit' | 'avatars' | 'lobby'>('main');
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
  // 头像审核两种管理员都有；大厅桌模板只给豆子管理员，策略审计只给发牌管理员。
  // 参数页（好友、私聊、勋章规则）第三轮随功能一起去掉，入口不再显示。
  const viewName = view === 'avatars' ? '头像审核' : isBeans ? view === 'lobby' ? '大厅桌模板' : '用户豆子' : view === 'audit' ? '策略审计' : '发牌策略';
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><Dices size={28} /><div><strong>斗十四</strong><span>运营管理台</span></div></div>
    <div className="nav-label">工作空间</div><nav aria-label="管理导航"><button className={view === 'main' ? 'active' : ''} onClick={() => setView('main')}>{isBeans ? <Coins size={19} /> : <Settings2 size={19} />}{isBeans ? '用户豆子' : '发牌策略'}</button>{isBeans && <button className={view === 'lobby' ? 'active' : ''} onClick={() => setView('lobby')}><LayoutGrid size={19} />大厅桌模板</button>}{!isBeans && <button className={view === 'audit' ? 'active' : ''} onClick={() => setView('audit')}><History size={19} />策略审计</button>}<button className={view === 'avatars' ? 'active' : ''} onClick={() => setView('avatars')}><Images size={19} />头像审核</button></nav>
    <div className="sidebar-bottom"><ShieldCheck size={17} /><span>{roleNames[user.role]}</span></div>
  </aside><div className="main-column"><header className="topbar"><div className="breadcrumbs"><span>管理台</span><ChevronRight size={14} /><strong>{viewName}</strong></div><div className="account-menu"><span>{user.nickname || user.username}</span><IconButton title="退出登录" onClick={logout}><LogOut size={18} /></IconButton></div></header>
    <main className="main-content"><div className="page-heading"><div><div className="eyebrow">{roleNames[user.role]}</div><h1>{isBeans ? '豆子管理' : '发牌管理'}</h1></div><IconButton title="刷新全部数据" onClick={changed}><RefreshCw size={18} /></IconButton></div><Statistics role={user.role} revision={revision} />
      {view === 'avatars' ? <AvatarReview revision={revision} onChange={changed} notify={setNotice} />
        : isBeans ? view === 'lobby' ? <LobbyTemplates revision={revision} onChange={changed} notify={setNotice} /> : <Wallets revision={revision} onChange={changed} notify={setNotice} />
        : view === 'audit' ? <Audit revision={revision} /> : <Policies revision={revision} onChange={changed} notify={setNotice} />}
    </main><footer className="page-footer"><span>斗十四 · 管理台</span><span>{roleNames[user.role]}</span></footer>
  </div>{notice && <div className="toast" role="status"><Check size={18} />{notice}<IconButton title="关闭通知" onClick={() => setNotice('')}><X size={16} /></IconButton></div>}</div>;
}
