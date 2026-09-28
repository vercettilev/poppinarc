import { Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from './config';
import { DbService } from './db/db.service';
import { FirebaseAuthGuard } from './auth/firebase-auth.guard';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }, DbService, FirebaseAuthGuard],
  exports: [APP_CONFIG, DbService, FirebaseAuthGuard],
})
export class AppModule {}
