export const SESSION_KEY = 'doushisi.admin.session';
export const EXPIRED_EVENT = 'doushisi-admin-session-expired';

const errorMessages: Record<string, string> = {
  INVALID_CREDENTIALS: '账号或密码错误。',
  UNAUTHORIZED: '登录已过期，请重新登录。',
  FORBIDDEN: '当前账号没有此操作权限。',
  USER_NOT_FOUND: '用户不存在。',
  INVALID_AMOUNT: '数量格式不正确，最多支持 12 位小数。',
  ZERO_ADJUSTMENT: '调整数量不能为 0。',
  INSUFFICIENT_BALANCE: '余额不足，人工扣除不能使余额低于 0。',
  REASON_REQUIRED: '请填写调整原因，最多 500 字。',
  REQUEST_ID_REQUIRED: '请求编号无效，请重新打开操作窗口。',
  IDEMPOTENCY_CONFLICT: '该请求编号已用于其他操作，请重新打开操作窗口。',
  INVALID_ADJUSTMENT_REFERENCE: '关联账目不存在或不属于当前用户。',
  VERSION_CONFLICT: '策略已更新，请重新载入后再保存。',
  INVALID_PROBABILITY: '概率必须在 0% 至 100% 之间，最多支持 2 位小数。',
  RATE_LIMITED: '请求过于频繁，请稍后重试。',
};

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem(SESSION_KEY);
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`/api/admin${path}`, { ...options, headers });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', '无法连接服务器，请检查网络后重试。');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && path !== '/login' && token === sessionStorage.getItem(SESSION_KEY)) {
      sessionStorage.removeItem(SESSION_KEY);
      window.dispatchEvent(new Event(EXPIRED_EVENT));
    }
    // 服务端统一回 {error:{code,message}}；也兼容契约里写的顶层 {code,message}。
    const failure = payload?.error && typeof payload.error === 'object' ? payload.error : typeof payload?.code === 'string' ? payload : null;
    throw new ApiError(response.status, failure?.code ?? 'REQUEST_FAILED',
      errorMessages[failure?.code] ?? failure?.message ?? `请求失败 (${response.status})`);
  }
  if (payload === null) throw new ApiError(response.status, 'INVALID_RESPONSE', '服务器响应格式不正确。');
  return payload as T;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请重试。';
}

// 服务端还没提供某个接口时，Fastify 回 404 且不带 {error:{code}}。
export const MISSING_ENDPOINT = '服务端尚未提供该接口';
export function isMissingEndpoint(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.code === 'REQUEST_FAILED';
}

// 头像地址是服务端给的根相对路径（/media/avatars/...），和 /api/admin 一样同源，原样使用；
// 只放行根相对路径和 http(s)，其他（如 javascript:、//外站）一律不显示。
export function mediaUrl(path?: string | null): string {
  if (!path) return '';
  return /^\/(?!\/)/.test(path) || /^https?:\/\//i.test(path) ? path : '';
}

export type Role = 'beans_admin' | 'deal_admin';
export interface AdminUser { id: string; username: string; nickname: string; role: Role }
export interface Player {
  id: string; username: string; nickname: string; balance: string; online: boolean;
  avatarHash?: string | null; avatarStatus?: string; nicknameRejected?: boolean; avatarUrl?: string;
}
export interface AvatarItem {
  userId: string; username: string; nickname: string; nicknameRejected: boolean;
  avatarHash: string | null; avatarStatus: string; uploadedAt: string; avatarUrl: string;
}
export interface LobbyVariant {
  key: string; name: string; defaults: Record<string, unknown>; needsBaseBeans: boolean; needsPlayerNum: boolean;
}
export interface LobbyTemplate {
  id: string; variantKey: string; variantName: string; options: Record<string, unknown>;
  standingEmpty: number; thresholdMultiplier: number; idleClearMinutes: number; enabled: boolean; sortOrder: number;
  summary: { baseBeans: string; playerNum: number; rounds: number } | null;
  openTables: number; seatedPlayers: number; updatedAt?: string;
}
export interface LedgerEntry {
  id: string; type: string; amount: string; balanceBefore: string; balanceAfter: string;
  reason: string; createdAt: string; actorName?: string; roomId?: string; roundId?: string;
  referenceEntryId?: string;
}
export interface DealPolicy {
  userId: string; username: string; nickname: string; enabled: boolean;
  probability: number; version: number; updatedAt?: string;
}
export interface AuditEntry {
  id: string; kind: string; userId: string; actorName?: string; createdAt: string;
  details: unknown;
}
export interface Pagination { total: number; page: number; pageSize: number }
export interface Stats {
  users: number; rooms: number; online: number; ledgerEntries: number; policyEnabled: number;
  policySelected: number; policyTriggered: number;
}
