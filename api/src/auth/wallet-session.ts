import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * THE SESSION A WALLET SIGN-IN GETS, signed by this service alone.
 *
 * Google sign-in ends in a Firebase ID token, which this service verifies with
 * nothing but the project id. A wallet has no Firebase account, and turning a
 * signature into one would take a custom token, which only the project's
 * service-account key can mint. That key can sign in as ANY Poppin user, so it
 * does not belong on a demo backend. A wallet session is therefore this
 * service's own: an HMAC over the account and its expiry, readable and
 * checkable here and nowhere else, which is the only place it is ever sent.
 *
 * The prefix is how FirebaseAuthGuard tells the two apart without trying
 * both: a Firebase ID token is a three-part JWT and never starts with it.
 */
export const WALLET_TOKEN_PREFIX = 'arcw_';
export const WALLET_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export interface WalletSession {
  /** The account id every table keys on: `evm:` plus the lowercase address. */
  uid: string;
  address: string;
  iat: number;
  exp: number;
}

export function walletUid(address: string): string {
  return `evm:${address.toLowerCase()}`;
}

const b64url = (b: Buffer): string => b.toString('base64url');
const mac = (body: string, secret: string): Buffer => createHmac('sha256', secret).update(`${WALLET_TOKEN_PREFIX}${body}`).digest();

export function signWalletSession(address: string, secret: string, now: number = Date.now()): string {
  const session: WalletSession = { uid: walletUid(address), address: address.toLowerCase(), iat: now, exp: now + WALLET_SESSION_MS };
  const body = b64url(Buffer.from(JSON.stringify(session)));
  return `${WALLET_TOKEN_PREFIX}${body}.${b64url(mac(body, secret))}`;
}

/** The session, or null for anything forged, altered, malformed or expired. */
export function verifyWalletSession(token: string, secret: string, now: number = Date.now()): WalletSession | null {
  if (!token.startsWith(WALLET_TOKEN_PREFIX)) return null;
  const [body, sig, extra] = token.slice(WALLET_TOKEN_PREFIX.length).split('.');
  if (!body || !sig || extra !== undefined) return null;
  const want = mac(body, secret);
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let s: Partial<WalletSession>;
  try {
    s = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<WalletSession>;
  } catch {
    return null;
  }
  if (typeof s.address !== 'string' || !/^0x[0-9a-f]{40}$/.test(s.address)) return null;
  if (s.uid !== walletUid(s.address)) return null;
  if (typeof s.exp !== 'number' || typeof s.iat !== 'number' || s.exp <= now) return null;
  return { uid: s.uid, address: s.address, iat: s.iat, exp: s.exp };
}
