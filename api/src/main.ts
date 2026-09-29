import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './config';

async function bootstrap() {
  // Body parsing is set up by hand so ONE path can take a photo: /upload
  // carries the picture as base64 JSON (the extension's UserService), which
  // Nest's default 100 KB limit would refuse. Everything else keeps a small
  // limit. A parsed body is not parsed twice (body-parser skips it).
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use('/api/v1/upload', json({ limit: '11mb' })); // 8 MB of picture as base64
  app.use(json({ limit: '256kb' }));
  app.use(urlencoded({ extended: true, limit: '256kb' }));
  const config = app.get<AppConfig>(APP_CONFIG);

  // Same prefix as api.poppin.so, so the extension's NEXT_PUBLIC_API_URL
  // points at either backend with nothing else changing.
  app.setGlobalPrefix('api/v1');

  // The extension calls from its service worker (chrome-extension://…), which
  // host permissions already exempt from CORS; this covers the side panel and
  // any page we name explicitly. Auth is a bearer token, never a cookie, but
  // the extension's axios client sends withCredentials, so the header has to
  // say yes or a CORS-bound caller would be refused for asking.
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin || origin.startsWith('chrome-extension://') || config.corsOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(null, false);
    },
    credentials: true,
  });

  await app.listen(config.port, '0.0.0.0');
  new Logger('arc-api').log(
    `listening on ${config.port}, Arc ${config.network.name} (chain ${config.network.chainId})`,
  );
}

void bootstrap();
