import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config';
import { AuthedUser, CurrentUser, FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { CircleWallets } from '../circle/wallets';
import { UserRow, UsersService } from '../users/users.service';
import { lower } from '../trade/types';

/**
 * THE EXTENSION'S USER ROUTES, answered from Poppin on Arc's own rows.
 *
 * The panel reads these bodies raw (no {data} envelope) and by the Solana
 * backend's column names, so the shapes below are that contract, not our
 * schema: `id` is the Firebase uid, `profile_photo_url` is our avatar_url.
 *
 * GET /users/me NEVER 404s. Right after sign-in the welcome flow asks it
 * once; a failure reads as "nobody is signed in", the panel opens the
 * welcome page and closes itself, and the reader loops back to sign-in. So
 * the first call creates the row, names it, and starts the wallet, and
 * anything that goes wrong in the naming or the wallet is logged and left
 * for a later call rather than turned into an error here.
 */

/** The client's own rule (ClaimIdentityStep, UpdateUserSchema max 15). */
export const USERNAME_RE = /^[a-zA-Z0-9_]{3,15}$/;
const USERNAME_MAX = 15;

/**
 * Names an automatic pick never lands on. A person may still choose one;
 * we just do not hand it out by accident.
 */
const RESERVED = new Set(['admin', 'poppin', 'support', 'root', 'system', 'help', 'api', 'settings', 'me']);

/**
 * Google gives an account without a photo its own letter tile
 * (…/default-user=…). That is a placeholder, and ours is the better one: the
 * Poppin ghost on one of six grounds, the same files and the same md5 pick as
 * the Solana product (apps/backend/src/avatar/avatar.util.ts), so one person
 * looks the same in both. The files are public and hold no user id.
 */
const GHOST_BASE = 'https://api.poppin.so/api/v1/avatar';

export function photoFor(uid: string, picture: string | null | undefined): string {
  const placeholder = typeof picture !== 'string' || picture.trim() === '' || /default-user/.test(picture);
  if (!placeholder) return picture!.trim();
  const ground = createHash('md5').update(uid).digest()[0] % 6;
  return `${GHOST_BASE}/ghost-${ground}.png`;
}

/**
 * The user row every route may rely on, created from the token on first use.
 *
 * The token's `name` is deliberately NOT stored as the display name. The
 * extension re-sends the stored display name on every profile save, and a
 * Google name the reader never typed (too long, or not Latin) would then be
 * the thing a save trips over. The Solana product leaves it empty for the
 * same reason (CreateProfileStep.tsx). The photo goes through photoFor.
 *
 * Wallet creation needs this row first: circle_wallets.uid references users.
 */
export function ensureUser(users: UsersService, u: AuthedUser): Promise<UserRow> {
  return users.ensure({ ...u, name: null, picture: photoFor(u.uid, u.picture) });
}

/**
 * A clean handle from whatever the token offers, or null when nothing yields
 * three usable characters. Letters are transliterated before stripping, so
 * "Uğur" becomes "ugur" and not "ur" (Turkish dotless i has no Unicode
 * decomposition, hence the explicit map).
 */
export function handleFrom(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .replace(/ß/g, 'ss')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[œŒ]/g, 'oe')
    .replace(/[øØ]/g, 'o')
    .replace(/[đĐ]/g, 'd')
    .replace(/[łŁ]/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s.\-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, USERNAME_MAX)
    .replace(/_+$/, '');
  return s.length >= 3 ? s : null;
}

/**
 * The base handle for a new account: the email's local part first (the
 * closest thing to a name the person already chose, and what the Solana
 * product does), then the token's name, then "poppin" for accounts that
 * carry neither (a wallet sign-in on the web app has no email and no name).
 */
export function usernameBase(seed: { email: string | null; name: string | null }): string {
  const local = (seed.email ?? '').split('@')[0].split('+')[0];
  return handleFrom(local) ?? handleFrom(seed.name) ?? 'poppin';
}

/**
 * The names we try, in order. Deterministic per uid on purpose: at sign-in
 * three surfaces ask /users/me at the same moment, and when they all walk the
 * same list against the same table they all settle on the same name instead
 * of racing each other to different ones.
 */
export function usernameCandidates(base: string, uid: string): string[] {
  const out: string[] = [];
  if (!RESERVED.has(base)) {
    out.push(base);
    for (let n = 2; n <= 4; n++) out.push(`${base.slice(0, USERNAME_MAX - String(n).length)}${n}`);
  }
  const stem = base.slice(0, 10).replace(/_+$/, '');
  for (let i = 0; i < 3; i++) {
    const h = createHash('sha256').update(`${uid}\u0000${i}`).digest().readUInt32BE(0);
    out.push(`${stem}_${1000 + (h % 9000)}`);
  }
  return [...new Set(out)].filter((c) => USERNAME_RE.test(c));
}

/** Resolves to the promise's value, or null once `ms` has passed. */
export function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Fields the extension reads that our schema does not store yet (bio, the two
 * settings switches, the cover photo). They are read off the row when a
 * later migration adds them, and answered with the extension's own defaults
 * until then: null switches read as "notifications on, wins private".
 */
interface ProfileExtras {
  bio: string | null;
  coverPhotoUrl: string | null;
  notificationsEnabled: boolean | null;
  publicWins: boolean | null;
}
type RowWithExtras = UserRow & Partial<ProfileExtras>;

/** What the extension reads about ANY user: profile pages, tips, the chip. */
export function publicView(row: UserRow) {
  const r = row as RowWithExtras;
  return {
    id: row.uid,
    username: row.username,
    display_name: row.displayName,
    profile_photo_url: row.avatarUrl,
    cover_photo_url: r.coverPhotoUrl ?? null,
    bio: r.bio ?? null,
    created_at: row.createdAt,
    role: 'user' as const,
    extraRoles: [] as string[],
    ditto: 0,
    twitter_id: null,
    twitter_username: null,
    twitterConnected: false,
    website: null,
    last_name: '',
    following_count: 0,
    followers_count: 0,
    comments_count: 0,
    activeStreakCount: 0,
    // Never another person's address. It would tie their name to every
    // balance and trade of their wallet, and nothing reads it: a tip names
    // the person (to_user_id) and the server finds the wallet.
    wallet_address: null as string | null,
  };
}

/**
 * The signed-in reader's own record. Every account on Arc trades from its
 * Circle wallet, so wallet_mode is always 'custodial': an 'external' answer
 * would send the chip down the Phantom leg, which does not exist here.
 * No access_token: it only signs the panel's own Firebase instance in, which
 * nothing reads, and this service holds no key that could mint one.
 */
export function meView(row: UserRow, walletAddress: string | null) {
  const r = row as RowWithExtras;
  return {
    ...publicView(row),
    wallet_address: walletAddress,
    notifications_enabled: r.notificationsEnabled ?? null,
    public_wins: r.publicWins ?? null,
    wallet_mode: 'custodial' as const,
    external_address: null,
  };
}

/** A parsed, validated profile change. Undefined means "leave as is". */
export interface ProfileChange {
  username?: string;
  displayName?: string;
  avatarUrl?: string | null;
  coverPhotoUrl?: string | null;
  bio?: string;
  notificationsEnabled?: boolean;
  publicWins?: boolean;
}

const bad = (message: string) => new BadRequestException(message);

function photoUrl(v: unknown, what: string): string | null | undefined {
  if (v === undefined || v === null) return v as null | undefined;
  if (typeof v !== 'string' || v.length > 2048 || !/^https?:\/\/\S+$/i.test(v.trim())) {
    throw bad(`${what} must be a web address`);
  }
  return v.trim();
}

function flag(v: unknown, what: string): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') throw bad(`${what} must be true or false`);
  return v;
}

/**
 * The PATCH body, checked field by field with sentences a person can read,
 * because several screens toast the API's message verbatim (edit-profile,
 * ClaimIdentityStep). The username messages are the client's own words.
 * Unknown keys are ignored, and email is never changed from here.
 */
export function parseProfileChange(body: unknown): ProfileChange {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw bad('Send the profile fields to change');
  }
  const b = body as Record<string, unknown>;
  const out: ProfileChange = {};

  if (b.username !== undefined && b.username !== null) {
    if (typeof b.username !== 'string') throw bad('Username must be at least 3 characters');
    const u = b.username.trim();
    if (u.length < 3) throw bad('Username must be at least 3 characters');
    if (u.length > USERNAME_MAX) throw bad('Username must be at most 15 characters');
    if (!USERNAME_RE.test(u)) throw bad('Only letters, numbers, and underscores are allowed');
    out.username = u;
  }

  // Omitted rather than emptied is the client's convention; an empty string
  // is read the same way instead of being refused.
  if (b.display_name !== undefined && b.display_name !== null) {
    if (typeof b.display_name !== 'string') throw bad('Display name must be text');
    const d = b.display_name.trim();
    if (d.length > 50) throw bad('Display name must be 50 characters or less');
    if (d) out.displayName = d;
  }

  // null means "no new photo" (ClaimIdentityStep sends it when none was
  // picked), so it keeps the current one.
  const avatar = photoUrl(b.profile_photo_url, 'Profile photo');
  if (avatar) out.avatarUrl = avatar;
  const cover = photoUrl(b.cover_photo_url, 'Cover photo');
  if (cover) out.coverPhotoUrl = cover;

  if (b.bio !== undefined && b.bio !== null) {
    if (typeof b.bio !== 'string') throw bad('Bio must be text');
    if (b.bio.length > 160) throw bad('Bio must be 160 characters or less');
    out.bio = b.bio;
  }

  const notifications = flag(b.notifications_enabled, 'Notifications');
  if (notifications !== undefined) out.notificationsEnabled = notifications;
  const wins = flag(b.public_wins, 'Public wins');
  if (wins !== undefined) out.publicWins = wins;

  return out;
}

@Controller('users')
export class UsersController {
  private readonly logger = new Logger('compat/users');
  /** One first-sign-in bootstrap per uid at a time; concurrent callers share it. */
  private readonly inflight = new Map<string, Promise<ReturnType<typeof meView>>>();
  /** Wallets being created in the background, one per uid. */
  private readonly walletStarts = new Set<string>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly users: UsersService,
    private readonly wallets: CircleWallets,
  ) {}

  @Get('me')
  @UseGuards(FirebaseAuthGuard)
  me(@CurrentUser() user: AuthedUser) {
    const running = this.inflight.get(user.uid);
    if (running) return running;
    const p = this.bootstrap(user).finally(() => this.inflight.delete(user.uid));
    this.inflight.set(user.uid, p);
    return p;
  }

  @Patch('me')
  @UseGuards(FirebaseAuthGuard)
  async update(@CurrentUser() user: AuthedUser, @Body() body: unknown) {
    const change = parseProfileChange(body);
    const row = await ensureUser(this.users, user);
    return this.apply(row, change);
  }

  /**
   * The create-profile form's submit when the panel thinks the account has no
   * name yet, which after a failed /users/me is every account. Names are
   * assigned automatically here, so a row that already has one is simply
   * updated; refusing it ("already registered") would put that refusal on
   * the form on every submit.
   */
  @Post('me/register')
  @UseGuards(FirebaseAuthGuard)
  async register(@CurrentUser() user: AuthedUser, @Body() body: unknown) {
    const change = parseProfileChange(body);
    if (!change.username) throw bad('Username must be at least 3 characters');
    const row = await ensureUser(this.users, user);
    return this.apply(row, change);
  }

  /** Public. The profile screen reads `.id` from it; 404 when nobody has the name. */
  @Get('username/:username')
  async byUsername(@Param('username') username: string) {
    if (!/^[A-Za-z0-9_.]{1,30}$/.test(username ?? '')) throw new NotFoundException('User not found');
    const row = await this.users.byUsername(username);
    if (!row) throw new NotFoundException('User not found');
    return publicView(row);
  }

  /** Public. Profile pages and popovers; the counts are the extension's zero defaults. */
  @Get('id/:id')
  async byId(@Param('id') id: string) {
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(id ?? '')) throw new NotFoundException('User not found');
    const row = await this.users.get(id);
    if (!row) throw new NotFoundException('User not found');
    return { ...publicView(row), follower_count: 0, is_following: false, is_pro: false };
  }

  private async bootstrap(user: AuthedUser) {
    let row = await ensureUser(this.users, user);
    if (!row.username) row = await this.assignUsername(row, user);
    const address = await this.storedAddress(user.uid);
    if (!address) this.startWallet(user.uid);
    return meView(row, address);
  }

  /**
   * Gives a new account its first name. A failure here is logged and leaves
   * the name empty, which the panel handles with its own create-profile step;
   * it never fails the request.
   */
  private async assignUsername(row: UserRow, user: AuthedUser): Promise<UserRow> {
    try {
      const base = usernameBase({ email: user.email, name: user.name });
      for (const candidate of usernameCandidates(base, user.uid)) {
        // The table's unique index compares exact bytes; this compares the
        // way people read names, so "Lev" and "lev" are one name.
        const holder = await this.users.byUsername(candidate);
        if (holder && holder.uid !== user.uid) continue;
        if (await this.users.setUsername(user.uid, candidate)) {
          return (await this.users.get(user.uid)) ?? { ...row, username: candidate };
        }
      }
      this.logger.warn(`no free username for ${user.uid} from base "${base}"`);
    } catch (e) {
      this.logger.warn(`username for ${user.uid} not assigned: ${(e as Error)?.message ?? e}`);
    }
    return row;
  }

  /**
   * Starts the Circle wallet of an account that has none, without waiting
   * for it. Nothing reads the address off the reader's own record (Receive
   * takes it from /wallets/me, which creates the wallet itself), while the
   * sign-in step awaits this route before it moves on and the share card
   * gives it about a second. So a Circle call here would only make the first
   * sign-in slow, and a hanging one would make every call slow.
   */
  private startWallet(uid: string): void {
    if (!this.wallets.configured || this.walletStarts.has(uid)) return;
    this.walletStarts.add(uid);
    this.wallets
      .ensureArcWallet(uid)
      .catch((e) => this.logger.warn(`arc wallet for ${uid} not ready: ${(e as Error)?.message ?? e}`))
      .finally(() => this.walletStarts.delete(uid));
  }

  /** The stored Arc address only, never a Circle call. */
  private async storedAddress(uid: string): Promise<string | null> {
    try {
      const w = await this.wallets.find(uid, this.config.network.walletsBlockchain);
      return w ? lower(w.address) : null;
    } catch {
      return null;
    }
  }

  private async apply(row: UserRow, change: ProfileChange) {
    const uid = row.uid;
    if (change.username !== undefined && change.username !== row.username) {
      // The check excludes the reader: ClaimIdentityStep re-sends the name it
      // was given, and a change of case is still the reader's own name.
      const holder = await this.users.byUsername(change.username);
      if (holder && holder.uid !== uid) throw bad('Username already exists');
      if (!(await this.users.setUsername(uid, change.username))) throw bad('Username already exists');
    }
    const { username: _u, ...profile } = change;
    if (Object.keys(profile).length) {
      // setProfile stores display name and photo today; the other keys ride
      // along so they persist as soon as its columns exist.
      await this.users.setProfile(uid, profile);
    }
    const fresh = (await this.users.get(uid)) ?? row;
    return meView(fresh, await this.storedAddress(uid));
  }
}
