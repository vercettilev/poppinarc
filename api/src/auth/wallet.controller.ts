import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ensureUser } from '../compat/users.controller';
import { publicBase } from '../compat/files.controller';
import { APP_CONFIG, AppConfig } from '../config';
import { UsersService } from '../users/users.service';
import { walletSignInPage } from './wallet-page';
import { signWalletSession, walletUid } from './wallet-session';
import { WalletSignin, WalletSigninRejected } from './wallet-signin';

/**
 * /auth/wallet: the page, the challenge, and the session.
 *
 *   GET  /auth/wallet            the sign-in page (auth/wallet-page.ts)
 *   POST /auth/wallet/challenge  { address, chainId } -> { message }
 *   POST /auth/wallet/verify     { message, signature } -> { token, uid, address }
 *
 * Unauthenticated by nature: this is where a session comes from. The domain
 * written into the message is the host the page was reached at, so the wallet
 * shows the reader the same host their address bar does.
 */
@Controller('auth/wallet')
export class WalletAuthController {
  private readonly logger = new Logger('auth/wallet');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly signin: WalletSignin,
    private readonly users: UsersService,
  ) {}

  @Get()
  page(@Res() res: Response): void {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    // A page that asks for a signature must never sit inside someone else's frame.
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.send(walletSignInPage());
  }

  @Post('challenge')
  @HttpCode(200)
  challenge(@Body() body: unknown, @Req() req: Request): { message: string } {
    this.enabled();
    const b = (body ?? {}) as { address?: unknown; chainId?: unknown };
    const base = publicBase(req);
    try {
      const message = this.signin.challenge({
        address: b.address,
        chainId: b.chainId,
        domain: new URL(base).host,
        uri: `${base}/api/v1/auth/wallet`,
      });
      return { message };
    } catch (e) {
      if (e instanceof WalletSigninRejected) throw new BadRequestException(e.message);
      throw e;
    }
  }

  @Post('verify')
  @HttpCode(200)
  async verify(@Body() body: unknown): Promise<{ token: string; uid: string; address: string }> {
    const secret = this.enabled();
    const b = (body ?? {}) as { message?: unknown; signature?: unknown };
    let address: string;
    try {
      address = await this.signin.verify({ message: b.message, signature: b.signature });
    } catch (e) {
      if (e instanceof WalletSigninRejected) throw new BadRequestException(e.message);
      this.logger.warn(`wallet verify failed: ${(e as Error)?.message ?? e}`);
      throw new BadRequestException('The signature could not be checked. Try again.');
    }
    const uid = walletUid(address);
    // The account row exists before the extension's first /users/me, as it does for Google.
    await ensureUser(this.users, { uid, email: null, name: null, picture: null });
    return { token: signWalletSession(address, secret), uid, address };
  }

  private enabled(): string {
    const secret = this.config.walletSessionSecret;
    if (!secret) throw new ServiceUnavailableException('Wallet sign-in is not set up yet.');
    return secret;
  }
}
