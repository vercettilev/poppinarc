import { Module } from '@nestjs/common';
import { ArcChain } from './arc/chain';
import { FirebaseAuthGuard } from './auth/firebase-auth.guard';
import { WalletAuthController } from './auth/wallet.controller';
import { WalletSignin } from './auth/wallet-signin';
import { CircleKit } from './circle/kit';
import { CircleWallets } from './circle/wallets';
import { AssetController } from './compat/asset.controller';
import { FilesController } from './compat/files.controller';
import { NoiseModule } from './compat/noise.controller';
import { UsersController } from './compat/users.controller';
import { ArcDepositsController, DEPOSITS, WalletsController } from './compat/wallets.controller';
import { APP_CONFIG, loadConfig } from './config';
import { DbService } from './db/db.service';
import { DepositsService } from './deposits/deposits.service';
import { FilesStore } from './files/files.store';
import { HealthController } from './health.controller';
import { MARKET_SELL_PROBE, MarketService } from './market/market.service';
import { MARKET } from './market/market.types';
import { CircleSwapRouter } from './routers/circle-swap.router';
import { KyberRouter } from './routers/kyber.router';
import { ActionsStore } from './trade/actions';
import { SWAP_ROUTERS, TradeService } from './trade/trade.service';
import { UsersService } from './users/users.service';

@Module({
  // NoiseModule LAST: its quiet stubs must never shadow a real route.
  imports: [NoiseModule],
  controllers: [HealthController, UsersController, WalletsController, ArcDepositsController, AssetController, FilesController, WalletAuthController],
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    DbService,
    FilesStore,
    WalletSignin,
    FirebaseAuthGuard,
    ArcChain,
    CircleKit,
    CircleWallets,
    ActionsStore,
    UsersService,
    CircleSwapRouter,
    KyberRouter,
    // Order matters: the first router whose supports() is true carries the
    // trade. Circle's own swap for USDC/EURC/cirBTC, the aggregator for the rest.
    {
      provide: SWAP_ROUTERS,
      useFactory: (circle: CircleSwapRouter, kyber: KyberRouter) => [circle, kyber],
      inject: [CircleSwapRouter, KyberRouter],
    },
    // The market gate's sell probe runs through the aggregator.
    {
      provide: MARKET_SELL_PROBE,
      useFactory: (kyber: KyberRouter) => kyber.sellProbe.bind(kyber),
      inject: [KyberRouter],
    },
    MarketService,
    { provide: MARKET, useExisting: MarketService },
    TradeService,
    DepositsService,
    { provide: DEPOSITS, useExisting: DepositsService },
  ],
  exports: [APP_CONFIG, DbService, FirebaseAuthGuard],
})
export class AppModule {}
