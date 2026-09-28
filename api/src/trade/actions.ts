import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import type { Leg } from './types';

export type ActionKind = 'buy' | 'sell' | 'deposit' | 'convert';
export type ActionStatus = 'pending' | 'sent' | 'confirmed' | 'failed';

export interface ActionRow {
  id: string;
  uid: string;
  kind: ActionKind;
  status: ActionStatus;
  tokenIn: string | null;
  tokenOut: string | null;
  amountInRaw: string | null;
  amountOutRaw: string | null;
  usdValue: number | null;
  sourceUrl: string | null;
  legs: Leg[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The ledger of every money movement this service starts. One row per user
 * action (a buy, a sell, a deposit moving to Arc), its onchain steps in `legs`.
 *
 * The row is written BEFORE the first Circle call, keyed by the action id that
 * every Circle idempotency key derives from. So after a crash or a timeout the
 * question "did we already send this?" has an answer in our own database, and
 * asking Circle again with the same keys returns the same transactions.
 */
@Injectable()
export class ActionsStore {
  constructor(private readonly db: DbService) {}

  async create(a: {
    id: string;
    uid: string;
    kind: ActionKind;
    tokenIn?: string | null;
    tokenOut?: string | null;
    amountInRaw?: bigint | null;
    usdValue?: number | null;
    sourceUrl?: string | null;
  }): Promise<{ created: boolean; row: ActionRow }> {
    const rows = await this.db.query(
      `INSERT INTO actions (id, uid, kind, status, token_in, token_out, amount_in_raw, usd_value, source_url)
       VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [
        a.id,
        a.uid,
        a.kind,
        a.tokenIn ?? null,
        a.tokenOut ?? null,
        a.amountInRaw?.toString() ?? null,
        a.usdValue ?? null,
        a.sourceUrl ?? null,
      ],
    );
    const row = await this.get(a.id);
    if (!row) throw new Error(`action ${a.id} vanished`);
    return { created: rows.length === 1, row };
  }

  async get(id: string): Promise<ActionRow | null> {
    const rows = await this.db.query('SELECT * FROM actions WHERE id = $1', [id]);
    return rows[0] ? toRow(rows[0]) : null;
  }

  /** The action whose swap (or any) leg carries this onchain hash. */
  async byTxHash(hash: string): Promise<ActionRow | null> {
    const rows = await this.db.query(
      `SELECT * FROM actions WHERE legs @> $1::jsonb ORDER BY created_at DESC LIMIT 1`,
      [JSON.stringify([{ txHash: hash.toLowerCase() }])],
    );
    return rows[0] ? toRow(rows[0]) : null;
  }

  async update(
    id: string,
    patch: { status?: ActionStatus; amountOutRaw?: bigint | null; legs?: Leg[]; error?: string | null },
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (patch.status !== undefined) add('status', patch.status);
    if (patch.amountOutRaw !== undefined) add('amount_out_raw', patch.amountOutRaw?.toString() ?? null);
    if (patch.legs !== undefined) add('legs', JSON.stringify(patch.legs.map(normalizeLeg)));
    if (patch.error !== undefined) add('error', patch.error);
    if (!sets.length) return;
    await this.db.query(`UPDATE actions SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
  }

  async listForUser(uid: string, limit = 50): Promise<ActionRow[]> {
    const rows = await this.db.query(
      'SELECT * FROM actions WHERE uid = $1 ORDER BY created_at DESC LIMIT $2',
      [uid, Math.min(Math.max(limit, 1), 200)],
    );
    return rows.map(toRow);
  }
}

function normalizeLeg(l: Leg): Leg {
  return l.txHash ? { ...l, txHash: l.txHash.toLowerCase() } : l;
}

function toRow(r: Record<string, any>): ActionRow {
  return {
    id: r.id,
    uid: r.uid,
    kind: r.kind,
    status: r.status,
    tokenIn: r.token_in,
    tokenOut: r.token_out,
    amountInRaw: r.amount_in_raw === null ? null : String(r.amount_in_raw),
    amountOutRaw: r.amount_out_raw === null ? null : String(r.amount_out_raw),
    usdValue: r.usd_value === null ? null : Number(r.usd_value),
    sourceUrl: r.source_url,
    legs: r.legs ?? [],
    error: r.error,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}
