import { Controller, Get, Inject } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from './config';
import { DbService } from './db/db.service';

/**
 * What is configured, never with what. Railway's healthcheck points here, and
 * it answers 200 even when Circle is not configured yet, so a missing key shows
 * up as `circle: false` instead of a crash loop.
 */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
  ) {}

  @Get()
  health() {
    return {
      ok: true,
      network: this.config.network.name,
      chainId: this.config.network.chainId,
      db: this.db.ready,
      circle: Boolean(this.config.circle.apiKey && this.config.circle.entitySecret),
      reader: Boolean(this.config.reader.apiKey),
      fee: this.config.feeBps > 0 && this.config.feeRecipient !== null,
    };
  }
}
