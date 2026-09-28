/**
 * The whole schema, in order. Append only: a shipped migration is never edited,
 * a change is a new entry.
 */
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'users, wallets, actions, settings',
    sql: `
      -- One row per Firebase identity. The uid is the same one the Solana
      -- product uses; the data behind it is not shared.
      CREATE TABLE users (
        uid text PRIMARY KEY,
        email text,
        username text UNIQUE,
        display_name text,
        avatar_url text,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      -- Circle developer-controlled wallets. Circle holds the keys; we hold
      -- the ids. One row per user per blockchain code (ARC, SOL, BASE, ...).
      CREATE TABLE circle_wallets (
        uid text NOT NULL REFERENCES users(uid),
        blockchain text NOT NULL,
        wallet_id text NOT NULL UNIQUE,
        address text NOT NULL,
        account_type text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (uid, blockchain)
      );
      CREATE INDEX circle_wallets_address ON circle_wallets (lower(address));

      -- Every money movement we start, whatever the rail: swap, bridge, send.
      -- 'legs' holds each onchain step (approve, swap, burn, mint) with its
      -- Circle transaction id and hash as they become known.
      CREATE TABLE actions (
        id uuid PRIMARY KEY,
        uid text NOT NULL REFERENCES users(uid),
        kind text NOT NULL,
        status text NOT NULL,
        token_in text,
        token_out text,
        amount_in_raw numeric,
        amount_out_raw numeric,
        usd_value numeric,
        source_url text,
        legs jsonb NOT NULL DEFAULT '[]'::jsonb,
        error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX actions_uid_created ON actions (uid, created_at DESC);

      -- Small service-wide facts, e.g. the Circle wallet set id per network.
      CREATE TABLE settings (
        key text PRIMARY KEY,
        value text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  {
    version: 2,
    name: 'case-insensitive usernames, profile extras',
    sql: `
      -- The extension checks names case-insensitively; so does the database.
      CREATE UNIQUE INDEX users_username_lower ON users (lower(username));
      ALTER TABLE users
        ADD COLUMN bio text,
        ADD COLUMN cover_photo_url text,
        ADD COLUMN notifications_enabled boolean,
        ADD COLUMN public_wins boolean;
    `,
  },
];
