import { createHash, randomUUID } from 'node:crypto';
import { catalogue, getDefaultOptions, getRoomSpec, getVariant, isVisibleVariant, supportsNewRoom, VISIBLE_VARIANT_KEYS } from '@dss/rules';
import type { Database } from './database.js';
import { requireRole, type Actor } from './auth.js';
import { AppError, requireCondition } from './errors.js';
import { avatarUrl } from './avatars.js';
import { Decimal, money } from './money.js';
import { DEFAULT_THRESHOLD_MULTIPLIER, type RoomService } from './rooms.js';
import type { ProfileService } from './profile.js';

// 大厅公开桌、快速开始、系统桌补桌与清座、附近档位（R1、R2、R4、R5、R10）。

export interface TemplateInput {
  variantKey: string; options: Record<string, unknown>; standingEmpty: number; thresholdMultiplier: number;
  idleClearMinutes: number; enabled: boolean; sortOrder: number;
}

// 后台界面直接显示 message，开房校验的英文错误在这里换成中文。
const templateErrors: Record<string, string> = {
  RULE_DEFAULT_NOT_VERIFIED: '这个玩法要填正数底分；需要选人数的还要选 2、3 或 4 人。',
  RULES_INCOMPLETE: '这个玩法的人数选项还没核实，不能做大厅桌。',
  INVALID_ROOM_OPTIONS: '玩法选项不完整，或者有不支持的组合。',
  GAME_REMOVED: '这个玩法已经下架。',
  UNKNOWN_VARIANT: '没有这个玩法。',
};

// 第一批系统桌（AI 暂定，后台可改）：新津斗十四 4 人 8 局，底分 1/2/5 各 3 张空桌。
const DEFAULT_TEMPLATES = ['1', '2', '5'].map((baseBeans, index) => ({
  variantKey: '4:0', options: { gameNum: 8, playerNum: 4, baseBeans }, standingEmpty: 3, thresholdMultiplier: DEFAULT_THRESHOLD_MULTIPLIER,
  idleClearMinutes: 10, enabled: true, sortOrder: index + 1,
}));

const LOCATION_TTL_MS = 10 * 60 * 1000;
const BANDS: [number, string][] = [[1, '1 公里内'], [5, '5 公里内'], [50, '同城']];

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const variantName = (key: string) => getVariant(key)?.name ?? key;

export class LobbyService {
  private locations = new Map<string, { lat: number; lon: number; at: number }>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private inFlight: Promise<void> | undefined;
  private queue: Promise<void> = Promise.resolve();
  private failedTemplates = new Set<string>();

  constructor(private db: Database, private rooms: RoomService, private options: {
    profiles?: ProfileService; profileRequired?: boolean; now?: () => number; onError?: (error: unknown) => void;
  } = {}) {}

  private now() { return (this.options.now ?? Date.now)(); }

  // ---------- 后台：桌模板 ----------

  private variants() {
    return catalogue.filter(variant => supportsNewRoom(variant.key) && isVisibleVariant(variant.key) && this.rooms.engines.has(variant.key)).map(variant => {
      const spec = getRoomSpec(variant.key);
      return { key: variant.key, name: variant.name, defaults: getDefaultOptions(variant.key),
        needsBaseBeans: spec.unresolvedFields.includes('basicTimes'), needsPlayerNum: spec.unresolvedFields.includes('playerNum') };
    });
  }

  private summary(variantKey: string, options: Record<string, unknown>) {
    try {
      const prepared = this.rooms.prepareRoom(variantKey, options);
      return { baseBeans: prepared.baseBeans, playerNum: prepared.playerCount, rounds: prepared.rounds };
    } catch { return null; }
  }

  async listTemplates() {
    const rows = await this.db.query(`SELECT t.*,
      (SELECT COUNT(*)::int FROM rooms r WHERE r.lobby_template_id=t.id AND r.state <> 'closed') AS "openTables",
      (SELECT COUNT(*)::int FROM room_members m JOIN rooms r ON r.id=m.room_id WHERE r.lobby_template_id=t.id AND r.state <> 'closed') AS "seatedPlayers"
      FROM lobby_templates t ORDER BY t.sort_order,t.created_at`);
    return {
      templates: rows.rows.map(row => ({ id: row.id, variantKey: row.variant_key, variantName: variantName(row.variant_key), options: row.options,
        standingEmpty: row.standing_empty, thresholdMultiplier: row.threshold_multiplier, idleClearMinutes: row.idle_clear_minutes,
        enabled: row.enabled, sortOrder: row.sort_order, summary: this.summary(row.variant_key, row.options),
        openTables: row.openTables, seatedPlayers: row.seatedPlayers, updatedAt: row.updated_at })),
      variants: this.variants(),
    };
  }

  private validateTemplate(input: TemplateInput) {
    requireCondition(Number.isInteger(input.standingEmpty) && input.standingEmpty >= 0 && input.standingEmpty <= 20, 'INVALID_TEMPLATE', '常驻空桌要在 0–20 张之间。');
    requireCondition(Number.isInteger(input.thresholdMultiplier) && input.thresholdMultiplier >= 1 && input.thresholdMultiplier <= 1000, 'INVALID_TEMPLATE', '门槛倍数要在 1–1000 之间。');
    requireCondition(Number.isInteger(input.idleClearMinutes) && input.idleClearMinutes >= 1 && input.idleClearMinutes <= 120, 'INVALID_TEMPLATE', '清座时限要在 1–120 分钟之间。');
    requireCondition(Number.isInteger(input.sortOrder) && Math.abs(input.sortOrder) <= 999999, 'INVALID_TEMPLATE', '排序要是 ±999999 以内的整数。');
    requireCondition(this.rooms.engines.has(input.variantKey), 'VARIANT_NOT_PLAYABLE', '这个玩法还不能开局，不能做大厅桌。');
    // 只留新津（S1 AC5）：其他玩法的老模板还能改成停用，不能新建或启用。
    requireCondition(isVisibleVariant(input.variantKey) || !input.enabled, 'VARIANT_HIDDEN', '大厅桌只能用新津斗十四；其他玩法的模板只能停用。');
    // 和玩家开房走同一套校验，保存下来的模板一定开得出桌子。
    try { this.rooms.prepareRoom(input.variantKey, input.options); }
    catch (error) {
      if (error instanceof AppError && templateErrors[error.code]) throw new AppError('INVALID_TEMPLATE', templateErrors[error.code]!, 400);
      if (error instanceof Error && error.name === 'RuleValidationError') throw new AppError('INVALID_TEMPLATE', `玩法选项不对：${error.message}`, 400);
      throw error;
    }
  }

  private async audit(admin: Actor, templateId: string, input: TemplateInput) {
    await this.db.query('INSERT INTO audit_events(id,actor_id,kind,details) VALUES($1,$2,$3,$4)',
      [randomUUID(), admin.id, 'lobby_template_saved', JSON.stringify({ templateId, ...input })]);
  }

  async createTemplate(admin: Actor, input: TemplateInput) {
    requireRole(admin, 'beans_admin');
    requireCondition(isVisibleVariant(input.variantKey), 'VARIANT_HIDDEN', '大厅桌只能用新津斗十四。');
    this.validateTemplate(input);
    const id = randomUUID();
    await this.db.query(`INSERT INTO lobby_templates(id,variant_key,options,standing_empty,threshold_multiplier,idle_clear_minutes,enabled,sort_order)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [id, input.variantKey, JSON.stringify(input.options), input.standingEmpty, input.thresholdMultiplier,
      input.idleClearMinutes, input.enabled, input.sortOrder]);
    await this.audit(admin, id, input);
    this.failedTemplates.delete(id);
    await this.refillAfterSave();
    return (await this.listTemplates()).templates.find(template => template.id === id)!;
  }

  // 改模板只影响之后补出来的桌子；已经开出来的桌子按开桌时的规则打完。
  async updateTemplate(admin: Actor, id: string, input: TemplateInput) {
    requireRole(admin, 'beans_admin');
    this.validateTemplate(input);
    const updated = await this.db.query(`UPDATE lobby_templates SET variant_key=$2,options=$3,standing_empty=$4,threshold_multiplier=$5,idle_clear_minutes=$6,
      enabled=$7,sort_order=$8,updated_at=now() WHERE id=$1 RETURNING id`, [id, input.variantKey, JSON.stringify(input.options), input.standingEmpty,
      input.thresholdMultiplier, input.idleClearMinutes, input.enabled, input.sortOrder]);
    requireCondition(updated.rows.length, 'TEMPLATE_NOT_FOUND', '这个模板不存在，可能已被删除。', 404);
    await this.audit(admin, id, input);
    this.failedTemplates.delete(id);
    // 规则变了：还没人坐的旧空桌关掉，由补桌按新规则补上。
    for (const room of (await this.db.query("SELECT r.id FROM rooms r WHERE r.lobby_template_id=$1 AND r.state='waiting' AND r.current_round=0 AND NOT EXISTS(SELECT 1 FROM room_members m WHERE m.room_id=r.id)", [id])).rows) {
      await this.rooms.closeEmptySystemRoom(room.id);
    }
    await this.refillAfterSave();
    return (await this.listTemplates()).templates.find(template => template.id === id)!;
  }

  // 保存后马上补桌，后台列表回来就是新桌数；补不出来不影响保存结果。
  private async refillAfterSave() { await this.maintain().catch(error => this.options.onError?.(error)); }

  /** 正式入口第一次启动时放入默认模板；之后只由后台改，不再自动补。 */
  async seedDefaults() {
    if ((await this.db.query('SELECT 1 FROM lobby_templates LIMIT 1')).rows.length) return;
    for (const template of DEFAULT_TEMPLATES) {
      if (!this.rooms.engines.has(template.variantKey)) continue;
      await this.db.query(`INSERT INTO lobby_templates(id,variant_key,options,standing_empty,threshold_multiplier,idle_clear_minutes,enabled,sort_order)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [randomUUID(), template.variantKey, JSON.stringify(template.options), template.standingEmpty,
        template.thresholdMultiplier, template.idleClearMinutes, template.enabled, template.sortOrder]);
    }
  }

  // ---------- 系统桌：补桌与清座 ----------

  /** 定时器和保存模板都会调用：排队一个个跑，避免同时补出多余的桌。 */
  maintain() {
    const run = this.queue.then(() => this.maintainOnce(), () => this.maintainOnce());
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async maintainOnce() {
    const templates = (await this.db.query('SELECT * FROM lobby_templates ORDER BY sort_order,created_at')).rows;
    for (const template of templates) {
      const empty = (await this.db.query(`SELECT r.id FROM rooms r WHERE r.lobby_template_id=$1 AND r.state='waiting' AND r.current_round=0
        AND NOT EXISTS(SELECT 1 FROM room_members m WHERE m.room_id=r.id) ORDER BY r.created_at`, [template.id])).rows;
      // 其他玩法的老模板不再补桌，空桌收掉；模板本身留着不动（S1）。
      const wanted = template.enabled && isVisibleVariant(template.variant_key) ? template.standing_empty : 0;
      for (const room of empty.slice(wanted).reverse()) await this.rooms.closeEmptySystemRoom(room.id);
      if (this.failedTemplates.has(template.id)) continue;
      for (let missing = wanted - empty.length; missing > 0; missing--) {
        try { await this.rooms.createSystemRoom(template.id, template.variant_key, template.options, template.region ?? undefined); }
        catch (error) {
          // 模板规则开不出桌（比如玩法下架）：记一次错，等后台改了再试，不每秒刷日志。
          this.failedTemplates.add(template.id); this.options.onError?.(error); break;
        }
      }
    }
    const idle = await this.db.query(`SELECT m.room_id,m.user_id,t.idle_clear_minutes FROM room_members m JOIN rooms r ON r.id=m.room_id
      JOIN lobby_templates t ON t.id=r.lobby_template_id WHERE r.state='waiting' AND r.current_round=0
      AND m.joined_at <= now() - make_interval(mins => t.idle_clear_minutes)`);
    for (const seat of idle.rows) await this.rooms.clearIdleSeat(seat.room_id, seat.user_id, seat.idle_clear_minutes);
  }

  start(intervalMs = 1000) {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      this.inFlight = this.maintain().catch(error => this.options.onError?.(error));
      await this.inFlight;
      if (this.running) { this.timer = setTimeout(tick, intervalMs); this.timer.unref(); }
    };
    void tick();
  }

  async stop() { this.running = false; clearTimeout(this.timer); await this.inFlight; }

  // ---------- 位置（只在内存，10 分钟过期，不写库） ----------

  setLocation(userId: string, lat: number, lon: number) {
    requireCondition(Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0),
      'INVALID_LOCATION', '位置不正确。');
    this.locations.set(userId, { lat, lon, at: this.now() });
  }

  clearLocation(userId: string) { this.locations.delete(userId); }

  private location(userId: string) {
    const found = this.locations.get(userId);
    if (!found) return null;
    if (this.now() - found.at > LOCATION_TTL_MS) { this.locations.delete(userId); return null; }
    return found;
  }

  // ---------- 玩家：大厅列表与快速开始 ----------

  async tables(userId: string, variant?: string, since?: string) {
    const rows = (await this.db.query(`SELECT r.id,r.code,r.variant_key,r.rules,r.player_count,r.rounds,r.current_round,r.state,r.created_at,
      r.lobby_template_id,t.threshold_multiplier,t.sort_order,m.seat,a.id AS user_id,a.nickname,a.avatar_hash AS "avatarHash",a.avatar_status AS "avatarStatus"
      FROM rooms r LEFT JOIN lobby_templates t ON t.id=r.lobby_template_id
      LEFT JOIN room_members m ON m.room_id=r.id LEFT JOIN accounts a ON a.id=m.user_id
      WHERE r.visibility='public' AND r.state <> 'closed' AND ($1::text IS NULL OR r.variant_key=$1) AND r.variant_key=ANY($2::text[])
      ORDER BY r.created_at,r.id,m.seat`, [variant ?? null, VISIBLE_VARIANT_KEYS])).rows;
    const me = this.location(userId);
    const byRoom = new Map<string, any>();
    for (const row of rows) {
      let table = byRoom.get(row.id);
      if (!table) {
        const baseBeans = money(row.rules?.baseBeans ?? '0');
        table = { code: row.code, variantKey: row.variant_key, variantName: variantName(row.variant_key), baseBeans,
          threshold: money(new Decimal(baseBeans).times(row.threshold_multiplier ?? DEFAULT_THRESHOLD_MULTIPLIER)),
          playerCount: row.player_count, rounds: row.rounds, currentRound: row.current_round,
          state: row.state === 'waiting' && row.current_round === 0 ? 'waiting' : 'playing', system: Boolean(row.lobby_template_id),
          seats: [], sortOrder: row.sort_order ?? Number.MAX_SAFE_INTEGER, createdAt: new Date(row.created_at).getTime(), nearestKm: Infinity };
        byRoom.set(row.id, table);
      }
      if (row.user_id) {
        table.seats.push({ seat: row.seat, nickname: row.nickname, avatarUrl: avatarUrl({ id: row.user_id, avatarHash: row.avatarHash, avatarStatus: row.avatarStatus }) });
        const there = row.user_id === userId ? null : this.location(row.user_id);
        if (me && there) table.nearestKm = Math.min(table.nearestKm, distanceKm(me, there));
      }
    }
    const all = [...byRoom.values()];
    const open = (table: any) => table.state === 'waiting' && table.seats.length < table.playerCount ? 0 : 1;
    all.sort((a, b) => open(a) - open(b) || b.seats.length - a.seats.length || a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
    // 附近只放有人坐、且桌上有人报了位置的桌；只给档位和名次，不给米数和坐标（R10 AC1、AC2）。
    const near = all.filter(table => table.seats.length && Number.isFinite(table.nearestKm)).sort((a, b) => a.nearestKm - b.nearestKm);
    near.forEach((table, index) => { table.nearby = { band: BANDS.find(([km]) => table.nearestKm <= km)?.[1] ?? '更远', rank: index + 1 }; });
    const tables = all.slice(0, 200).map(({ sortOrder, createdAt, nearestKm, ...table }) => table);
    const variants = (await this.db.query(`SELECT DISTINCT variant_key FROM lobby_templates WHERE enabled
      UNION SELECT DISTINCT variant_key FROM rooms WHERE visibility='public' AND state <> 'closed'`)).rows
      .filter(row => isVisibleVariant(row.variant_key)).map(row => ({ key: row.variant_key as string, name: variantName(row.variant_key) })).sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
    const body = { tables, variants, hasLocation: Boolean(me) };
    const version = createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0, 16);
    // 版本没变只回一个标记，大厅每 2 秒拉一次也几乎不占流量（R1 AC1）。
    return since === version ? { version, unchanged: true as const } : { version, ...body };
  }

  async quickStart(actor: Actor, variant?: string) {
    requireRole(actor, 'player');
    if (this.options.profileRequired) await this.options.profiles!.requireComplete(actor.id);
    const current = await this.rooms.current(actor.id);
    // 已经在桌上（比如断线后回来）：直接回原桌。
    if (current) return { code: current.code, joined: false };
    const balance = new Decimal((await this.db.query('SELECT balance::text FROM wallets WHERE user_id=$1', [actor.id])).rows[0]?.balance ?? '0');
    const candidates = (await this.db.query(`SELECT r.code,r.rules,r.player_count,t.threshold_multiplier,t.sort_order,r.created_at,COUNT(m.user_id)::int AS seated
      FROM rooms r LEFT JOIN lobby_templates t ON t.id=r.lobby_template_id LEFT JOIN room_members m ON m.room_id=r.id
      WHERE r.visibility='public' AND r.state='waiting' AND r.current_round=0 AND ($1::text IS NULL OR r.variant_key=$1) AND r.variant_key=ANY($2::text[])
      GROUP BY r.id,t.threshold_multiplier,t.sort_order HAVING COUNT(m.user_id) < r.player_count`, [variant ?? null, VISIBLE_VARIANT_KEYS])).rows;
    const need = (row: Record<string, any>) => new Decimal(row.rules?.baseBeans ?? '0').times(row.threshold_multiplier ?? DEFAULT_THRESHOLD_MULTIPLIER);
    const affordable = candidates.filter(row => balance.greaterThanOrEqualTo(need(row)))
      .sort((a, b) => b.seated - a.seated || (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    // 人最多的优先；抢座失败（刚坐满、刚开局）就换下一张（R4 AC1）。
    for (const row of affordable) {
      try { await this.rooms.join(actor, row.code); return { code: row.code as string, joined: true }; }
      catch (error) { if (!(error instanceof AppError) || !['ROOM_FULL', 'ROOM_STARTED', 'ROOM_NOT_FOUND', 'BELOW_THRESHOLD'].includes(error.code)) throw error; }
    }
    const templates = (await this.db.query('SELECT * FROM lobby_templates WHERE enabled AND ($1::text IS NULL OR variant_key=$1) AND variant_key=ANY($2::text[]) ORDER BY sort_order,created_at', [variant ?? null, VISIBLE_VARIANT_KEYS])).rows
      .flatMap(template => {
        const summary = this.summary(template.variant_key, template.options);
        return summary ? [{ template, need: new Decimal(summary.baseBeans).times(template.threshold_multiplier) }] : [];
      });
    requireCondition(templates.length || candidates.length, 'LOBBY_EMPTY', '这个玩法暂时没有大厅桌。', 404);
    const usable = templates.find(entry => balance.greaterThanOrEqualTo(entry.need));
    if (!usable) {
      const lowest = [...templates.map(entry => entry.need), ...candidates.map(need)].reduce((a, b) => (a.lessThan(b) ? a : b));
      throw new AppError('BELOW_THRESHOLD', `豆子不足：这个玩法最少要 ${money(lowest)} 豆才能入座，你还差 ${money(lowest.minus(balance))} 豆。`, 409);
    }
    // 找不到合适的桌：按模板新开一张再坐下（R4 AC2）。
    const room = await this.rooms.createSystemRoom(usable.template.id, usable.template.variant_key, usable.template.options, usable.template.region ?? undefined);
    await this.rooms.join(actor, room.code);
    return { code: room.code, joined: true };
  }
}
