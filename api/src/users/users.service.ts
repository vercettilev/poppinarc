import { Injectable } from '@nestjs/common';
import type { AuthedUser } from '../auth/firebase-auth.guard';
import { DbService } from '../db/db.service';

export interface UserRow {
  uid: string;
  email: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

/**
 * Poppin on Arc's own user rows. The identity is the Firebase uid shared with
 * the Solana product; nothing else is shared, and a first request creates the
 * row from the token's own claims.
 */
@Injectable()
export class UsersService {
  constructor(private readonly db: DbService) {}

  async ensure(u: AuthedUser): Promise<UserRow> {
    await this.db.query(
      `INSERT INTO users (uid, email, display_name, avatar_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (uid) DO UPDATE SET
         email = COALESCE(EXCLUDED.email, users.email),
         display_name = COALESCE(users.display_name, EXCLUDED.display_name),
         avatar_url = COALESCE(users.avatar_url, EXCLUDED.avatar_url)`,
      [u.uid, u.email, u.name, u.picture],
    );
    return (await this.get(u.uid))!;
  }

  async get(uid: string): Promise<UserRow | null> {
    const rows = await this.db.query('SELECT * FROM users WHERE uid = $1', [uid]);
    const r = rows[0];
    return r
      ? {
          uid: r.uid,
          email: r.email,
          username: r.username,
          displayName: r.display_name,
          avatarUrl: r.avatar_url,
          createdAt: new Date(r.created_at).toISOString(),
        }
      : null;
  }

  async byUsername(username: string): Promise<UserRow | null> {
    const rows = await this.db.query('SELECT uid FROM users WHERE lower(username) = lower($1)', [username]);
    return rows[0] ? this.get(rows[0].uid) : null;
  }

  /** Returns false when the name is taken (unique index), true when set. */
  async setUsername(uid: string, username: string): Promise<boolean> {
    try {
      await this.db.query('UPDATE users SET username = $2 WHERE uid = $1', [uid, username]);
      return true;
    } catch (e: any) {
      if (e?.code === '23505') return false;
      throw e;
    }
  }

  async setProfile(uid: string, p: { displayName?: string | null; avatarUrl?: string | null }): Promise<void> {
    await this.db.query(
      `UPDATE users SET
         display_name = COALESCE($2, display_name),
         avatar_url = COALESCE($3, avatar_url)
       WHERE uid = $1`,
      [uid, p.displayName ?? null, p.avatarUrl ?? null],
    );
  }
}
