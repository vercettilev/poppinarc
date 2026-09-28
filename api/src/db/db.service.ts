import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { APP_CONFIG, AppConfig } from '../config';
import { MIGRATIONS } from './migrations';

/**
 * This service's own Postgres, and nobody else's.
 *
 * The July testnet backend turned out to read the PRODUCTION database. This
 * database belongs to a separate Railway project, and the boot log prints the
 * host it connected to so a wrong DATABASE_URL is visible on the first line
 * rather than discovered weeks later.
 */
@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  private pool: Pool | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.databaseUrl) {
      this.logger.warn('DATABASE_URL is not set: routes that need storage will answer 503');
      return;
    }
    this.pool = new Pool({ connectionString: this.config.databaseUrl, max: 10 });
    const host = new URL(this.config.databaseUrl).host;
    this.logger.log(`connected to ${host}`);
    await this.migrate();
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  get ready(): boolean {
    return this.pool !== null;
  }

  async query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.pool) throw new Error('database is not configured');
    const res = await this.pool.query<T>(sql, params);
    return res.rows;
  }

  async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool) throw new Error('database is not configured');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Numbered migrations, each applied once and recorded. Not
   * `CREATE TABLE IF NOT EXISTS` alone: that never alters a table that already
   * exists, so a changed column would silently never arrive.
   */
  private async migrate(): Promise<void> {
    await this.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const done = new Set(
      (await this.query<{ version: number }>('SELECT version FROM schema_migrations')).map((r) => r.version),
    );
    for (const m of MIGRATIONS) {
      if (done.has(m.version)) continue;
      await this.tx(async (c) => {
        await c.query(m.sql);
        await c.query('INSERT INTO schema_migrations (version) VALUES ($1)', [m.version]);
      });
      this.logger.log(`migration ${m.version} applied: ${m.name}`);
    }
  }
}
