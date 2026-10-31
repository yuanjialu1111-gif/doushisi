import type { Database, Sql } from './database.js';

export interface PlayStats { rounds: number; wins: number; winRate: string }

/** S6-AC1：胜率 = 胜局 ÷ 局数，四舍五入到整数 %，没打过是 0%。 */
export const winRate = (rounds: number, wins: number): string => `${rounds ? Math.round(wins * 100 / rounds) : 0}%`;

export class StatsService {
  constructor(private db: Database) {}

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

  /** 首页战绩：对局数、胜率、豆子（第三轮去掉勋章，R6）。 */
  async profile(userId: string) {
    return { ...(await this.stats(userId)), beans: await this.beans(userId, this.db) };
  }
}
