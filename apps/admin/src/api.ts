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
    throw new ApiError(response.status, payload?.error?.code ?? 'REQUEST_FAILED',
      errorMessages[payload?.error?.code] ?? payload?.error?.message ?? `请求失败 (${response.status})`);
  }
  if (payload === null) throw new ApiError(response.status, 'INVALID_RESPONSE', '服务器响应格式不正确。');
  return payload as T;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请重试。';
}

export type Role = 'beans_admin' | 'deal_admin';
export interface AdminUser { id: string; username: string; nickname: string; role: Role }
export interface Player { id: string; username: string; nickname: string; balance: string; online: boolean }
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
