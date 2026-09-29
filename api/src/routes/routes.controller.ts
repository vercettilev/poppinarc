import { Body, Controller, HttpCode, NotFoundException, Post } from '@nestjs/common';
import { remoteAssetByTicker, remoteAssetOf } from './remote';
import { RouteQuotes, type RoutePreview } from './route-quotes';

/**
 * POST /embed/asset/route  { mint: "remote:sol" | ticker, amountUsd }  ->  RoutePreview
 *
 * Public like /quote: a price and a route are no one's secret, and the panel
 * shows them before anyone signs in.
 */
@Controller('embed/asset')
export class RoutesController {
  constructor(private readonly routes: RouteQuotes) {}

  @Post('route')
  @HttpCode(200)
  route(@Body() body: unknown): Promise<RoutePreview> {
    const b = (body ?? {}) as { mint?: unknown; amountUsd?: unknown };
    const asset = remoteAssetOf(b.mint) ?? remoteAssetByTicker(b.mint);
    if (!asset) throw new NotFoundException('No route for this asset.');
    return this.routes.preview(asset, Number(b.amountUsd ?? 25));
  }
}
