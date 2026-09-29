import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthedUser, CurrentUser, FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { publicBase } from '../compat/files.controller';
import { confirmTradePage } from './confirm-page';
import { OwnWalletTrades } from './own-wallet';

/**
 * Trades signed by the person's own wallet (trade/own-wallet.ts).
 *
 *   POST /embed/asset/external/prepare  (signed in)  { side, mint, amountUsd | amountRaw, sourceUrl }
 *   GET  /embed/asset/external/status   (signed in)  ?id=
 *   POST /embed/asset/external/cancel   (signed in)  { id }
 *   GET  /wallet/confirm                the confirm page; id and key in the fragment
 *   POST /wallet/confirm/data           { id, t }
 *   POST /wallet/confirm/submit         { id, t, approveHash, swapHash }
 *   POST /wallet/confirm/cancel         { id, t }
 *
 * The confirm routes carry no session: the page holds only the one-off key in
 * its link, and submit counts nothing it cannot read from the chain.
 */
@Controller()
export class OwnWalletController {
  constructor(private readonly trades: OwnWalletTrades) {}

  @Post('embed/asset/external/prepare')
  @HttpCode(200)
  @UseGuards(FirebaseAuthGuard)
  prepare(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: Request) {
    return this.trades.prepare(user.uid, body, publicBase(req));
  }

  @Get('embed/asset/external/status')
  @UseGuards(FirebaseAuthGuard)
  status(@CurrentUser() user: AuthedUser, @Query('id') id: unknown) {
    return this.trades.status(user.uid, id);
  }

  @Post('embed/asset/external/cancel')
  @HttpCode(200)
  @UseGuards(FirebaseAuthGuard)
  cancel(@CurrentUser() user: AuthedUser, @Body() body: unknown) {
    return this.trades.cancel({ uid: user.uid }, (body as { id?: unknown } | null)?.id);
  }

  @Get('wallet/confirm')
  page(@Res() res: Response): void {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    // A page that asks a wallet to send money must never sit inside someone else's frame.
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.send(confirmTradePage());
  }

  @Post('wallet/confirm/data')
  @HttpCode(200)
  data(@Body() body: unknown) {
    const b = (body ?? {}) as { id?: unknown; t?: unknown };
    return this.trades.pageData(b.id, b.t);
  }

  @Post('wallet/confirm/submit')
  @HttpCode(200)
  submit(@Body() body: unknown) {
    return this.trades.submit(body);
  }

  @Post('wallet/confirm/cancel')
  @HttpCode(200)
  pageCancel(@Body() body: unknown) {
    const b = (body ?? {}) as { id?: unknown; t?: unknown };
    return this.trades.cancel({ token: b.t }, b.id);
  }
}
