import { Controller, Get, HttpCode, Module, NotFoundException, Post, Query } from '@nestjs/common';

/**
 * The quiet answers: routes the extension calls on startup or on a timer
 * for features the Arc edition does not have (points, referrals, streaks,
 * the social boards, site chat, standing orders, the server copy of price
 * alerts, telemetry).
 *
 * WHY THEY EXIST AT ALL. The extension logs every non-2xx that goes through
 * its API_REQUEST relay with console.error, except a 404 under /site-chat/.
 * Left unrouted, these would turn chrome://extensions' Errors panel red
 * within a minute of install and keep it red. So each one answers the
 * smallest shape the client already treats as "nothing to show": an empty
 * list, a null rank, `{ mint: null }`.
 *
 * NONE OF THEM PRETENDS. Nothing is recorded, nothing is created, and every
 * answer is literally true on Arc: there are no orders, no alerts on the
 * server, no leaderboard rows. POSTs that would record something accept the
 * body and drop it, and say so where the shape has room (`recorded: false`,
 * `kept: 0`, `closed: 0`).
 *
 * NO GUARD ON ANY ROUTE. The answers are constants, so a token protects
 * nothing, and a 401 here costs twice: the client logs it, and its axios
 * interceptor forces a Firebase token refresh and sends the request again.
 * Signed-out readers call several of these too (telemetry above all), and
 * an open /user-events means they never fall through to /user-events/anon.
 *
 * THREE DELIBERATE EXCEPTIONS to "200 and empty":
 *  - site-chat answers a real 404. The document heartbeat reads a 200, even
 *    `{ count: null }`, as "chat exists, count unknown" and keeps beating
 *    every 15s in every visible tab; a 404 marks the host dark for six hours
 *    and stops the timer. The relay logs /site-chat/ 404s at debug level.
 *  - /referrals/stats answers 204. The front door's invite row renders for
 *    ANY object, even `{}`, and there is no referral program on Arc to
 *    invite anyone into. A 204 reaches the client as an empty string, which
 *    both the row (`!stats`) and the chip (`!s?.code`) read as "none".
 *  - placing or cancelling a standing order answers a 404 WITH A SENTENCE.
 *    Those are presses, not background noise, so a 200 would claim an order
 *    that does not exist. Left unrouted, Nest's own 404 says "Cannot POST
 *    /api/v1/embed/asset/order", which passes the client's sentence check
 *    (capital first, no code words) and would be printed in red under the
 *    chip and in the trade sheet. Our sentence reaches the reader instead.
 *
 * REGISTERED LAST, THROUGH NoiseModule. Nest hands Express the routes in
 * module order (the root module's own controllers first, then its imports
 * depth first), and on a duplicate path the first one registered answers
 * with no warning. A stub that registers early would quietly shadow the real
 * route the day another controller serves it, so this controller is only
 * ever mounted by importing NoiseModule as the LAST entry of AppModule's
 * imports, never by listing it in a `controllers` array.
 */

export interface FlywheelBoardWire {
  period: 'week' | 'all';
  rows: never[];
  viewer: null;
  viewerRank: null;
  viewerNext: null;
  weights: never[];
  allTimeSince: null;
}

export interface FlywheelPoolWire {
  pool: {
    poolUsd: number;
    viewerCohortMult: number;
    viewerShareUsd: null;
    viewerCohortRank: null;
  };
  seatsLeft: number;
}

export interface AlertsWire {
  open: never[];
  fired: never[];
}

/**
 * What a reader sees after pressing Place order or Cancel. Plain sentences
 * the client passes through as they are; none may carry a path, a code word
 * or a dash, or the client swaps in its own generic line.
 */
export const ORDER_REFUSALS = {
  place: 'Trade at the live price for now.',
  cancel: 'You have no open orders.',
} as const;

@Controller()
export class NoiseController {
  // ─── telemetry ────────────────────────────────────────────────────────────

  /**
   * The funnel ingest. Fire-and-forget on the client and never read, so it
   * is accepted and dropped: this service keeps no event store, and the
   * truthful answer is that nothing was recorded.
   */
  @Post('user-events')
  @HttpCode(200)
  userEvent(): { recorded: boolean } {
    return { recorded: false };
  }

  /** Reached only after a 401 on the route above, which this service never gives. */
  @Post('user-events/anon')
  @HttpCode(200)
  userEventAnon(): { recorded: boolean } {
    return { recorded: false };
  }

  // ─── presence and site chat ───────────────────────────────────────────────

  /** Must stay a 404; see the header. */
  @Post('site-chat/presence/ping')
  sitePresencePing(): never {
    throw new NotFoundException('No live chat here');
  }

  /** 404 is the client's "no_chat". Unreachable once the pill is dark, answered anyway. */
  @Post('site-chat/ticket')
  siteChatTicket(): never {
    throw new NotFoundException('No live chat here');
  }

  /**
   * Readers with a card on this host. Zero is honest (no page rooms run
   * here) and silent: both callers hide any count below 2. A 404 would be
   * console.error on every host change in the panel header.
   */
  @Get('ticks/pages/:host/presence')
  pagePresence(): { onlineCount: number } {
    return { onlineCount: 0 };
  }

  // ─── the chip's bell ──────────────────────────────────────────────────────

  /** The bell's social rows. Fired alerts and fills are local and still show. */
  @Get('users/me/notifications')
  notifications(): { data: never[]; meta: { hasNextPage: boolean } } {
    return { data: [], meta: { hasNextPage: false } };
  }

  // ─── points, referrals, streaks ───────────────────────────────────────────

  /**
   * An empty board. `viewerRank: null` is what keeps the chip's rank line
   * and the background's once-a-minute "You moved up" check silent; the
   * Leaderboard view draws its own empty state from `rows: []`.
   */
  @Get('flywheel/leaderboard')
  leaderboard(@Query('period') period?: unknown): FlywheelBoardWire {
    return {
      period: period === 'all' ? 'all' : 'week',
      rows: [],
      viewer: null,
      viewerRank: null,
      viewerNext: null,
      weights: [],
      allTimeSince: null,
    };
  }

  /**
   * Read after every landed chip buy. `viewerCohortRank: null` keeps the
   * founding-seat line off the receipt. The "+N pts" line cannot be turned
   * off from here: the client falls back to a multiplier of 1 on ANY
   * answer, error included, so only leaving out its `points` dep hides it.
   */
  @Get('flywheel/pool')
  pool(): FlywheelPoolWire {
    return {
      pool: { poolUsd: 0, viewerCohortMult: 1, viewerShareUsd: null, viewerCohortRank: null },
      seatsLeft: 0,
    };
  }

  /** 204, not an empty object; see the header. */
  @Get('referrals/stats')
  @HttpCode(204)
  referralStats(): void {
    return;
  }

  /**
   * Fires on every feed and profile render. The client sends
   * `user_ids[]=a&user_ids[]=b` (axios brackets arrays); nothing is read,
   * so every spelling gets the same empty list, which it maps to streak 0.
   */
  @Get('streaks/user-streaks')
  userStreaks(): never[] {
    return [];
  }

  // ─── social boards ────────────────────────────────────────────────────────

  /** One read per page, cached ten minutes by the chip; empty means no caller line. */
  @Get('spot/social/callers')
  callers(): { callers: never[] } {
    return { callers: [] };
  }

  /**
   * The background's 2-minute poll. A 200 moves its `since` watermark, so
   * the next poll asks for less, not the same window again.
   */
  @Get('spot/social/following-trades')
  followingTrades(): { trades: never[] } {
    return { trades: [] };
  }

  /** The feed's wins rail hides itself below two names. */
  @Get('spot/social/top-wins')
  topWins(): { wins: never[] } {
    return { wins: [] };
  }

  /** The profile vitrine is silent when empty, for your own and anyone else's. */
  @Get('spot/social/my-wins')
  myWins(): { wins: never[] } {
    return { wins: [] };
  }

  @Get('spot/social/wins/:userId')
  winsFor(): { wins: never[] } {
    return { wins: [] };
  }

  /** "N traders here bought X in the last hour". The panel re-asks every five minutes. */
  @Get('website-post/consensus')
  consensus(): { mint: null } {
    return { mint: null };
  }

  // ─── the order-watch alarm ────────────────────────────────────────────────

  /**
   * Standing orders do not exist on Arc, so both lists are empty. The
   * background's watch needs a successful read to seed itself; with no keys
   * on either side it never announces a fill.
   */
  @Post('embed/asset/orders')
  @HttpCode(200)
  orders(): { orders: never[] } {
    return { orders: [] };
  }

  /** Only sent after a fill, which cannot happen with no orders. */
  @Post('embed/asset/fills/seen')
  @HttpCode(200)
  fillsSeen(): { closed: number } {
    return { closed: 0 };
  }

  /**
   * Price alerts live in the extension and fire from its own alarm; only the
   * server copy (the email when Chrome is closed) is missing. This GET is
   * also the client's "still open" check-in, twice a tick when it holds
   * alerts. `fired` must be an array for the client to read it.
   */
  @Get('embed/asset/alerts')
  alerts(): AlertsWire {
    return { open: [], fired: [] };
  }

  /** Nothing is kept, and the answer says so. The client never reads it. */
  @Post('embed/asset/alerts/sync')
  @HttpCode(200)
  alertsSync(): { kept: number } {
    return { kept: 0 };
  }

  /** Removing an alert the server never held: done, trivially. */
  @Post('embed/asset/alerts/remove')
  @HttpCode(200)
  alertsRemove(): { ok: true } {
    return { ok: true };
  }

  /** The client's "I already said it", so a server sweep would not email it. There is no sweep. */
  @Post('embed/asset/alerts/fired')
  @HttpCode(200)
  alertsFired(): { ok: true } {
    return { ok: true };
  }

  // ─── placing and cancelling standing orders ───────────────────────────────

  /**
   * The chip's limit buy and limit sell and the sheet's order mode still
   * reach here on Arc. Both custodial and page-wallet routes refuse before
   * anything is signed, so nothing moved and a market trade is the way on.
   */
  @Post('embed/asset/order')
  placeOrder(): never {
    throw new NotFoundException(ORDER_REFUSALS.place);
  }

  @Post('embed/asset/order/external/prepare')
  prepareExternalOrder(): never {
    throw new NotFoundException(ORDER_REFUSALS.place);
  }

  /** Needs a preparedId from a prepare above, so it cannot be reached; answered the same way. */
  @Post('embed/asset/order/external/submit')
  submitExternalOrder(): never {
    throw new NotFoundException(ORDER_REFUSALS.place);
  }

  /** The order list is always empty here, so there is never one to cancel. */
  @Post('embed/asset/order/cancel')
  cancelOrder(): never {
    throw new NotFoundException(ORDER_REFUSALS.cancel);
  }

  @Post('embed/asset/order/cancel/external/prepare')
  prepareExternalCancel(): never {
    throw new NotFoundException(ORDER_REFUSALS.cancel);
  }
}

/**
 * The only way to mount NoiseController. Import it LAST in AppModule's
 * `imports` so every real route, in AppModule's own controllers or in any
 * module imported before it, registers first and wins; see the header.
 */
@Module({ controllers: [NoiseController] })
export class NoiseModule {}
