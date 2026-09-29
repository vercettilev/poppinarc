import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { App, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { APP_CONFIG, AppConfig } from '../config';
import { verifyWalletSession, WALLET_TOKEN_PREFIX } from './wallet-session';

export interface AuthedUser {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

/**
 * Accepts the same Firebase ID token the Poppin extension already sends to
 * the Solana product (`Authorization: Bearer …`, added by the extension's
 * axios interceptor).
 *
 * NO SECRET IS NEEDED. Verifying an ID token only needs the project id and
 * Google's public signing certificates, which firebase-admin fetches itself.
 * This service never holds the service-account key that can MINT tokens;
 * sign-in still happens at app.poppin.so, whose token reaches this extension
 * build through the page's postMessage relay.
 *
 * A WALLET SIGN-IN carries this service's own session instead (prefix arcw_,
 * see auth/wallet-session.ts), checked with a secret that lives only here.
 * It names the account `evm:<address>`, and every route below treats it like
 * any other account.
 */
@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  private readonly app: App;
  private readonly walletSecret: string | null;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.walletSecret = config.walletSessionSecret ?? null;
    const existing = getApps().find((a) => a.name === 'poppin-arc');
    this.app = existing ?? initializeApp({ projectId: config.firebaseProjectId }, 'poppin-arc');
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) throw new UnauthorizedException('Sign in to continue');
    if (token.startsWith(WALLET_TOKEN_PREFIX)) {
      const session = this.walletSecret ? verifyWalletSession(token, this.walletSecret) : null;
      if (!session) throw new UnauthorizedException('Your session expired. Sign in again.');
      const user: AuthedUser = { uid: session.uid, email: null, name: null, picture: null };
      req.user = user;
      return true;
    }
    try {
      const decoded = await getAuth(this.app).verifyIdToken(token);
      const user: AuthedUser = {
        uid: decoded.uid,
        email: decoded.email ?? null,
        name: (decoded.name as string | undefined) ?? null,
        picture: decoded.picture ?? null,
      };
      req.user = user;
      return true;
    } catch {
      throw new UnauthorizedException('Your session expired. Sign in again.');
    }
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthedUser => {
  return ctx.switchToHttp().getRequest().user;
});
