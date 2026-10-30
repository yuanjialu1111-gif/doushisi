import type { RoomService } from './rooms.js';

export interface SchedulerResult { checked: number; applied: number; failed: number }
export class RoomScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<SchedulerResult> | undefined;
  private running = false;
  constructor(private rooms: RoomService, private options: {
    intervalMs?: number; batchSize?: number; concurrency?: number; onError: (error: unknown, roomId?: string) => void;
  }) {
    if (options.intervalMs !== undefined && (!Number.isInteger(options.intervalMs) || options.intervalMs < 10)) throw new Error('Scheduler interval must be at least 10 ms');
    if (options.batchSize !== undefined && (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 500)) throw new Error('Scheduler batch size must be between 1 and 500');
    if (options.concurrency !== undefined && (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 16)) throw new Error('Scheduler concurrency must be between 1 and 16');
  }

  /** Runs once on startup and then polls the durable due-time index. */
  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      try { await this.poll(); } catch (error) { this.options.onError(error); }
      if (this.running) { this.timer = setTimeout(tick, this.options.intervalMs ?? 250); this.timer.unref(); }
    };
    void tick();
  }

  async stop(): Promise<void> {
    this.running = false;
    clearTimeout(this.timer);
    // The polling loop reports failures; shutdown still drains a failed in-flight scan.
    await this.inFlight?.catch(() => undefined);
  }

  poll(): Promise<SchedulerResult> {
    if (this.inFlight) return this.inFlight;
    const work = async () => {
      const ids = await this.rooms.dueRoomIds(this.options.batchSize ?? 100);
      const result = { checked: ids.length, applied: 0, failed: 0 };
      let next = 0;
      const worker = async () => {
        while (next < ids.length) {
          const roomId = ids[next++]!;
          try { if (await this.rooms.applyDueAction(roomId)) result.applied++; }
          catch (error) { result.failed++; this.options.onError(error, roomId); }
        }
      };
      await Promise.all(Array.from({ length: Math.min(ids.length, this.options.concurrency ?? 8) }, worker));
      return result;
    };
    this.inFlight = work().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }
}
