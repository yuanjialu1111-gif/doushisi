import { randomUUID } from 'node:crypto';
import type { Database } from './database.js';
import { requireRole, type Actor } from './auth.js';
import { requireCondition } from './errors.js';

// 后台「参数」页能改的业务参数（第二轮计划 2.8）。没存过的键用这里的默认值，改了立刻生效。
export const SETTING_DEFS = {
  friendLimit: { group: '好友', label: '好友上限', unit: '人', min: 10, max: 1000, value: 200 },
  dailyFriendRequests: { group: '好友', label: '每天最多发出的好友申请', unit: '个', min: 1, max: 200, value: 20 },
  friendRequestExpiryDays: { group: '好友', label: '好友申请没人处理自动过期', unit: '天', min: 1, max: 30, value: 7 },
  rejectCooldownHours: { group: '好友', label: '被拒后多久才能再申请同一个人', unit: '小时', min: 0, max: 720, value: 24 },
  searchPerMinute: { group: '好友', label: '每人每分钟最多搜 ID', unit: '次', min: 1, max: 60, value: 10 },
  inviteSeconds: { group: '私聊和邀请', label: '邀请有效时间（同一好友两次邀请的间隔也用它）', unit: '秒', min: 10, max: 600, value: 60 },
  messageRetentionDays: { group: '私聊和邀请', label: '私聊消息保留', unit: '天', min: 1, max: 365, value: 30 },
  medalQiantuRounds: { group: '勋章', label: '前途无量：累计对局', unit: '局', min: 1, max: 1_000_000, value: 10 },
  medalBaishengWins: { group: '勋章', label: '百胜王：累计胜局', unit: '局', min: 1, max: 1_000_000, value: 100 },
  medalQianshengWins: { group: '勋章', label: '千胜王：累计胜局', unit: '局', min: 1, max: 1_000_000, value: 1000 },
  medalFujiaBeans: { group: '勋章', label: '富甲一方：豆子达到', unit: '豆', min: 1, max: 1_000_000_000_000, value: 10_000 },
  medalBaiwanBeans: { group: '勋章', label: '百万富翁：豆子达到', unit: '豆', min: 1, max: 1_000_000_000_000, value: 1_000_000 },
  medalQianwanBeans: { group: '勋章', label: '千万富翁：豆子达到', unit: '豆', min: 1, max: 1_000_000_000_000, value: 10_000_000 },
} as const;

export type SettingKey = keyof typeof SETTING_DEFS;
export type Settings = Record<SettingKey, number>;
const KEYS = Object.keys(SETTING_DEFS) as SettingKey[];

export const defaultSettings = (): Settings => Object.fromEntries(KEYS.map(key => [key, SETTING_DEFS[key].value])) as Settings;

export class SettingsService {
  private cache: Settings | null = null;
  constructor(private db: Database) {}

  async get(): Promise<Settings> {
    if (this.cache) return this.cache;
    const values = defaultSettings();
    for (const row of (await this.db.query('SELECT key,value FROM app_settings')).rows) {
      const key = row.key as SettingKey;
      // 删掉或改过范围的旧键不影响启动：认不出或越界就用默认值。
      if (key in SETTING_DEFS && valid(key, row.value)) values[key] = row.value as number;
    }
    this.cache = values;
    return values;
  }

  async list() {
    const values = await this.get();
    return { settings: KEYS.map(key => ({ key, ...SETTING_DEFS[key], defaultValue: SETTING_DEFS[key].value, value: values[key] })) };
  }

  async update(admin: Actor, changes: Record<string, unknown>) {
    requireRole(admin, 'beans_admin');
    const entries = Object.entries(changes);
    requireCondition(entries.length > 0, 'INVALID_SETTINGS', '没有要保存的参数。');
    for (const [key, value] of entries) {
      requireCondition(key in SETTING_DEFS, 'INVALID_SETTINGS', `没有这个参数：${key}`);
      const def = SETTING_DEFS[key as SettingKey];
      requireCondition(valid(key as SettingKey, value), 'INVALID_SETTINGS', `${def.label}要是 ${def.min}–${def.max} 之间的整数。`);
    }
    const before = await this.get();
    await this.db.transaction(async tx => {
      for (const [key, value] of entries) {
        await tx.query(`INSERT INTO app_settings(key,value,updated_at,updated_by) VALUES($1,$2,now(),$3)
          ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now(),updated_by=EXCLUDED.updated_by`, [key, JSON.stringify(value), admin.id]);
      }
      await tx.query('INSERT INTO audit_events(id,actor_id,kind,details) VALUES($1,$2,$3,$4)', [randomUUID(), admin.id, 'settings_changed',
        JSON.stringify({ changes: Object.fromEntries(entries.map(([key, value]) => [key, { before: before[key as SettingKey], after: value }])) })]);
    });
    this.cache = null;
    return this.list();
  }
}

function valid(key: SettingKey, value: unknown): value is number {
  const def = SETTING_DEFS[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= def.min && value <= def.max;
}
