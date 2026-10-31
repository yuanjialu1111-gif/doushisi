import type { Database, Sql } from './database.js';
import type { SettingKey, SettingsService } from './settings.js';

type MedalKind = 'rounds' | 'wins' | 'beans';
interface MedalDef { key: string; name: string; kind: MedalKind; setting: SettingKey }

/** 第二轮 S6：6 个勋章，顺序就是个人资料里的摆放顺序，条件从后台参数读。 */
export const MEDALS: readonly MedalDef[] = [
  { key: 'qiantu', name: '前途无量', kind: 'rounds', setting: 'medalQiantuRounds' },
  { key: 'baisheng', name: '百胜王', kind: 'wins', setting: 'medalBaishengWins' },
  { key: 'qiansheng', name: '千胜王', kind: 'wins', setting: 'medalQianshengWins' },
  { key: 'fujia', name: '富甲一方', kind: 'beans', setting: 'medalFujiaBeans' },
  { key: 'baiwan', name: '百万富翁', kind: 'beans', setting: 'medalBaiwanBeans' },
  { key: 'qianwan', name: '千万富翁', kind: 'beans', setting: 'medalQianwanBeans' },
];

export interface PlayStats { rounds: number; wins: number; winRate: string }

/** S6-AC1：胜率 = 胜局 ÷ 局数，四舍五入到整数 %，没打过是 0%。 */
export const winRate = (rounds: number, wins: number): string => `${rounds ? Math.round(wins * 100 / rounds) : 0}%`;

const beansText = (value: number) => value >= 10_000 && value % 10_000 === 0 ? `${value / 10_000} 万` : value.toLocaleString('en-US');
const hint = (kind: MedalKind, need: number) => kind === 'rounds' ? `打满 ${need} 局` : kind === 'wins' ? `赢 ${need} 局` : `豆子 ${beansText(need)}`;

export class StatsService {
  constructor(private db: Database, private settings: SettingsService) {}

  /** S6-AC1：已结算的每局里我的结算得分，大于 0 算赢一局。 */
  async stats(userId: string, sql: Sql = this.db): Promise<PlayStats> {
    const row = (await sql.query(`SELECT count(*)::int AS rounds, (count(*) FILTER (WHERE (p->>'amount')::numeric > 0))::int AS wins
      FROM room_members m JOIN rounds r ON r.room_id=m.room_id AND r.state='settled'
      CROSS JOIN LATERAL jsonb_array_elements(r.results) p
      WHERE m.user_id=$1 AND p->>'userId'=$1::text`, [userId])).rows[0] ?? { rounds: 0, wins: 0 };
    return { rounds: row.rounds, wins: row.wins, winRate: winRate(row.rounds, row.wins) };
  }

  private async beans(userId: string, sql: Sql): Promise<number> {
    const row = (await sql.query('SELECT floor(balance)::text AS beans FROM wallets WHERE user_id=$1', [userId])).rows[0];
    return row ? Number(row.beans) : 0;
  }

  /**
   * S6-AC2/AC3：到了条件就记一条点亮，已经亮的不动（ON CONFLICT DO NOTHING），所以豆子变少也不会灭。
   * 结算后（同一个事务里）、登录时、打开资料时都调。
   */
  async lightMedals(userId: string, sql: Sql = this.db): Promise<{ stats: PlayStats; beans: number }> {
    const stats = await this.stats(userId, sql), beans = await this.beans(userId, sql), settings = await this.settings.get(sql);
    const value = { rounds: stats.rounds, wins: stats.wins, beans };
    const reached = MEDALS.filter(medal => value[medal.kind] >= settings[medal.setting]).map(medal => medal.key);
    if (reached.length) await sql.query(`INSERT INTO account_medals(account_id,medal) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`, [userId, reached]);
    return { stats, beans };
  }

  async profile(userId: string) {
    const { stats, beans } = await this.lightMedals(userId);
    const settings = await this.settings.get();
    const unlocked = new Map((await this.db.query('SELECT medal,unlocked_at FROM account_medals WHERE account_id=$1', [userId])).rows
      .map(row => [row.medal as string, new Date(row.unlocked_at).toISOString()]));
    const value = { rounds: stats.rounds, wins: stats.wins, beans };
    const medals = MEDALS.map(medal => ({ key: medal.key, name: medal.name, kind: medal.kind, lit: unlocked.has(medal.key),
      unlockedAt: unlocked.get(medal.key) ?? null, value: value[medal.kind], need: settings[medal.setting], hint: hint(medal.kind, settings[medal.setting]) }));
    return { ...stats, beans, lit: medals.filter(medal => medal.lit).length, medals };
  }
}
