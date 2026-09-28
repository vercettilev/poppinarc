import { ARC_NETWORKS, ArcNetwork, ArcNetworkName } from './arc/network';

/**
 * Everything this service reads from the environment, read once at boot.
 *
 * A VALUE THAT LOOKS LIKE A PLACEHOLDER IS NOT A VALUE. A template pasted
 * verbatim ("<Circle API key>", "changeme", "your-key") is a non-empty string,
 * and a plain truthiness check reads it as configured: that is how a feature
 * turned itself on in production once (X_CLIENT_ID, 2026-08-26). Every secret
 * here goes through `real()` so a placeholder behaves exactly like a missing
 * variable, and the boot log says which one.
 */

const PLACEHOLDER = /^\s*$|^<.*>$|^(changeme|todo|xxx+|your[-_ ].*|placeholder)$/i;

export function real(value: string | undefined): string | null {
  if (value === undefined) return null;
  const v = value.trim();
  return PLACEHOLDER.test(v) ? null : v;
}

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  const v = real(value);
  if (v === null) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`expected an integer between ${min} and ${max}, got "${v}"`);
  }
  return n;
}

export interface AppConfig {
  network: ArcNetwork;
  port: number;
  databaseUrl: string | null;
  /** Firebase project whose ID tokens we accept. Verification needs no secret. */
  firebaseProjectId: string;
  circle: {
    apiKey: string | null;
    entitySecret: string | null;
  };
  /** Poppin's own fee, the same variable name and meaning as the Solana product. */
  feeBps: number;
  /** Where Poppin's fee lands on Arc. Receiving needs no key on this server. */
  feeRecipient: `0x${string}` | null;
  rpcUrl: string;
  corsOrigins: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const networkName = (real(env.ARC_NETWORK) ?? 'testnet') as ArcNetworkName;
  if (!(networkName in ARC_NETWORKS)) {
    throw new Error(`ARC_NETWORK must be "mainnet" or "testnet", got "${networkName}"`);
  }
  const network = ARC_NETWORKS[networkName];

  const apiKey = real(env.CIRCLE_API_KEY);
  // A testnet key on mainnet (or the reverse) fails on the first call with a
  // message about something else entirely. Refuse the pairing at boot instead.
  if (apiKey) {
    const live = apiKey.startsWith('LIVE_API_KEY:');
    const test = apiKey.startsWith('TEST_API_KEY:');
    if (networkName === 'mainnet' && !live) {
      throw new Error('ARC_NETWORK=mainnet needs a LIVE_API_KEY');
    }
    if (networkName === 'testnet' && !test) {
      throw new Error('ARC_NETWORK=testnet needs a TEST_API_KEY');
    }
  }

  const feeRecipient = real(env.FEE_RECIPIENT);
  if (feeRecipient && !/^0x[0-9a-fA-F]{40}$/.test(feeRecipient)) {
    throw new Error('FEE_RECIPIENT must be a 0x address');
  }

  return {
    network,
    port: int(env.PORT, 3000, 1, 65535),
    databaseUrl: real(env.DATABASE_URL),
    firebaseProjectId: real(env.FIREBASE_PROJECT_ID) ?? 'commentin-6a05a',
    circle: {
      apiKey,
      entitySecret: real(env.CIRCLE_ENTITY_SECRET),
    },
    feeBps: int(env.SPOT_FEE_BPS, 0, 0, 500),
    feeRecipient: (feeRecipient as `0x${string}` | null) ?? null,
    rpcUrl: real(env.ARC_RPC_URL) ?? network.rpcUrl,
    corsOrigins: (real(env.CORS_ORIGINS) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
