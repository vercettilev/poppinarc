import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AppKit } from '@circle-fin/app-kit';
import { createCircleWalletsAdapter, type CircleWalletsAdapter } from '@circle-fin/adapter-circle-wallets';
import { APP_CONFIG, AppConfig } from '../config';

/**
 * CIRCLE APP KIT, driven by Circle Wallets.
 *
 * One AppKit instance for Bridge (circle/bridge.ts) and Swap
 * (routers/circle-swap.router.ts), and one Circle Wallets adapter that signs
 * for every user's developer-controlled wallet on Arc and on Solana. The
 * adapter is told which wallet by address on each call; it holds no state
 * about users.
 *
 * Both are made on first use, so a deploy without Circle keys still boots and
 * answers health checks; the first money route answers 503 instead.
 */
@Injectable()
export class CircleKit {
  private kitInstance: AppKit | null = null;
  private adapterInstance: CircleWalletsAdapter | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get kit(): AppKit {
    this.kitInstance ??= new AppKit({ disableAnalytics: true });
    return this.kitInstance;
  }

  get adapter(): CircleWalletsAdapter {
    const { apiKey, entitySecret } = this.config.circle;
    if (!apiKey || !entitySecret) {
      throw new ServiceUnavailableException('Wallets are not set up yet');
    }
    this.adapterInstance ??= createCircleWalletsAdapter({ apiKey, entitySecret });
    return this.adapterInstance;
  }

  /** App Kit's name for the Arc network this deploy runs on. */
  get arcChain(): 'Arc' | 'Arc_Testnet' {
    return this.config.network.appKitChain;
  }

  /** App Kit's name for Solana on the matching network. */
  get solanaChain(): 'Solana' | 'Solana_Devnet' {
    return this.config.network.name === 'mainnet' ? 'Solana' : 'Solana_Devnet';
  }
}

/** JSON.stringify that survives App Kit results, whose step data carries bigints. */
export function toJsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}
