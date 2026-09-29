import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config';
import { DbService } from '../db/db.service';
import { looksLikeMoney, readerAsset } from './catalog';
import { askClaude, costMicroUsd, type ReaderVerdict } from './claude';

/**
 * THE AI READER: the second pass behind the chip's own rules.
 *
 * The chip names an asset on the device when a post says it outright (a
 * cashtag, "Bitcoin", "EURC"). Most talk about money does not: "the ECB held
 * again" is about the euro, "Strategy bought another 2,000" is about bitcoin.
 * When the rules find nothing, the extension sends the post's text here, and
 * Claude says which asset (if any) the text is about and why, in one line.
 *
 * WHAT KEEPS IT CHEAP, in the order it is applied:
 * 1. Texts with no sign of money in them are never sent (catalog.looksLikeMoney).
 * 2. A text is read once: answers are kept by a hash of the model and the text,
 *    so a post seen by many readers costs one read. The text is not kept.
 * 3. Up to eight texts share one question.
 * 4. A hard daily ceiling (ARC_READER_DAILY_USD, default $1): past it the
 *    reader answers nothing until the next UTC day, and the chip behaves
 *    exactly as it would without a reader.
 * 5. Each account may ask about 120 texts an hour.
 */

export interface ReadAnswer {
  id: string;
  asset: { mint: string; ticker: string; name: string; displayName: string } | null;
  reason: string | null;
}

const MAX_ITEMS = 8;
const MAX_TEXT = 1_200;
const PER_HOUR = 120;
const HOUR_MS = 60 * 60 * 1000;
const CACHE_DAYS = 7;

const spendKey = (now: Date) => `reader_spend:${now.toISOString().slice(0, 10)}`;

@Injectable()
export class PageReader {
  private readonly logger = new Logger('reader');
  private readonly asked = new Map<string, number[]>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
  ) {}

  get enabled(): boolean {
    return Boolean(this.config.reader.apiKey);
  }

  async read(uid: string, raw: unknown, fetchFn?: typeof fetch): Promise<{ items: ReadAnswer[] }> {
    const items = parseItems(raw);
    this.spend(uid, items.length);
    const answers = new Map<string, ReadAnswer>();
    const empty = (id: string): ReadAnswer => ({ id, asset: null, reason: null });

    const pending: Array<{ id: string; text: string; key: string }> = [];
    for (const it of items) {
      if (!looksLikeMoney(it.text)) {
        answers.set(it.id, empty(it.id));
        continue;
      }
      pending.push({ ...it, key: this.cacheKey(it.text) });
    }

    // Already read, by anyone.
    if (pending.length) {
      const rows = await this.db.query<{ key: string; asset: string | null; reason: string }>(
        `SELECT key, asset, reason FROM reader_cache
         WHERE key = ANY($1::text[]) AND created_at > now() - ($2 || ' days')::interval`,
        [pending.map((p) => p.key), String(CACHE_DAYS)],
      );
      const hit = new Map(rows.map((r) => [r.key, r]));
      for (let i = pending.length - 1; i >= 0; i--) {
        const p = pending[i]!;
        const row = hit.get(p.key);
        if (!row) continue;
        answers.set(p.id, this.answer(p.id, { key: row.asset, reason: row.reason }));
        pending.splice(i, 1);
      }
    }

    if (pending.length && this.enabled && (await this.underCeiling())) {
      try {
        const { verdicts, usage } = await askClaude({
          apiKey: this.config.reader.apiKey!,
          model: this.config.reader.model,
          items: pending.map((p) => ({ id: p.id, text: p.text })),
          fetchFn,
        });
        await this.addSpend(costMicroUsd(this.config.reader.model, usage));
        for (const p of pending) {
          const v = verdicts.get(p.id);
          if (!v) continue;
          answers.set(p.id, this.answer(p.id, v));
          await this.db.query(
            `INSERT INTO reader_cache (key, asset, reason) VALUES ($1, $2, $3)
             ON CONFLICT (key) DO UPDATE SET asset = EXCLUDED.asset, reason = EXCLUDED.reason, created_at = now()`,
            [p.key, v.key, v.reason],
          );
        }
      } catch (e) {
        // The chip goes on without the reader: nothing it shows depends on this answer.
        this.logger.warn(`reader failed: ${(e as Error)?.message ?? e}`);
      }
    }

    return { items: items.map((it) => answers.get(it.id) ?? empty(it.id)) };
  }

  private answer(id: string, v: ReaderVerdict): ReadAnswer {
    const asset = v.key ? readerAsset(v.key) : null;
    if (!asset) return { id, asset: null, reason: v.reason || null };
    return {
      id,
      asset: {
        mint: asset.address(this.config.network).toLowerCase(),
        ticker: asset.ticker,
        name: asset.name,
        displayName: asset.name,
      },
      reason: v.reason || `About ${asset.name.toLowerCase()}.`,
    };
  }

  private cacheKey(text: string): string {
    return createHash('sha256').update(`${this.config.reader.model}\u0000${text}`).digest('hex');
  }

  /** At most PER_HOUR texts an hour for one account; a text already read costs the same, which is fine. */
  private spend(uid: string, n: number): void {
    const now = Date.now();
    const recent = (this.asked.get(uid) ?? []).filter((t) => now - t < HOUR_MS);
    if (recent.length + n > PER_HOUR) {
      throw new HttpException('Too many reads for now. Try again in a while.', HttpStatus.TOO_MANY_REQUESTS);
    }
    for (let i = 0; i < n; i++) recent.push(now);
    this.asked.set(uid, recent);
    if (this.asked.size > 10_000) this.asked.clear();
  }

  private async underCeiling(now = new Date()): Promise<boolean> {
    const rows = await this.db.query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [spendKey(now)]);
    const spent = Number(rows[0]?.value ?? 0);
    return spent < this.config.reader.dailyUsd * 1_000_000;
  }

  private async addSpend(microUsd: number, now = new Date()): Promise<void> {
    await this.db.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = ((settings.value)::bigint + (EXCLUDED.value)::bigint)::text, updated_at = now()`,
      [spendKey(now), String(microUsd)],
    );
  }
}

function parseItems(raw: unknown): Array<{ id: string; text: string }> {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length === 0 || list.length > MAX_ITEMS) {
    throw new BadRequestException(`Send between 1 and ${MAX_ITEMS} texts.`);
  }
  const seen = new Set<string>();
  const out: Array<{ id: string; text: string }> = [];
  for (const r of list) {
    const row = r as { id?: unknown; text?: unknown };
    if (typeof row.id !== 'string' || !/^[\w:.-]{1,64}$/.test(row.id) || seen.has(row.id)) {
      throw new BadRequestException('Every text needs its own short id.');
    }
    if (typeof row.text !== 'string') throw new BadRequestException('Every text needs its text.');
    seen.add(row.id);
    out.push({ id: row.id, text: row.text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) });
  }
  return out;
}
