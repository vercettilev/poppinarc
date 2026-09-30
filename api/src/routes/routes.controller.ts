import { Body, Controller, Inject, HttpCode, Logger, NotFoundException, Optional, Post, ServiceUnavailableException } from '@nestjs/common';
import { FarTrades } from '../far/far-trades';
import { remoteAssetByTicker } from './remote';
import { RemoteTokens } from './remote-tokens';
import { RouteQuotes, type RoutePreview } from './route-quotes';

/**
 * POST /embed/asset/route  { mint: "remote:sol" | "remote:<chain>:<address>" | ticker, amountUsd }  ->  RoutePreview
 *
 * Public like /quote: a price and a route are no one's secret, and the panel
 * shows them before anyone signs in.
 */
@Controller('embed/asset')
export class RoutesController {
  private readonly logger = new Logger('routes');

  constructor(
    private readonly routes: RouteQuotes,
    private readonly tokens: RemoteTokens,
    @Optional() @Inject(FarTrades) private readonly far: FarTrades | null = null,
  ) {}

  @Post('route')
  @HttpCode(200)
  async route(@Body() body: unknown): Promise<RoutePreview> {
    const b = (body ?? {}) as { mint?: unknown; amountUsd?: unknown };
    let asset = remoteAssetByTicker(b.mint);
    if (!asset) {
      const listing = await this.tokens.assetOf(b.mint).catch((e: unknown) => {
        this.logger.warn(`route ${String(b.mint)}: ${(e as Error)?.message ?? e}`);
        throw new ServiceUnavailableException('Lookup unavailable');
      });
      asset = listing?.asset ?? null;
    }
    if (!asset) throw new NotFoundException('No route for this asset.');
    const preview = await this.routes.preview(asset, Number(b.amountUsd ?? 25));
    if (!this.far?.opensFor(asset)) return preview;
    // A copy: the preview is cached and shared, and only this deploy's readers can buy it.
    return {
      ...preview,
      available: true,
      note: `You approve each step in your wallet. Network fees on ${preview.asset.chain} are paid in USDC, so you need no ETH.`,
    };
  }
}
