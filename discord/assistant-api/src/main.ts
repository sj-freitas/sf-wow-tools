import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WorkerService } from './worker/worker.service';

async function bootstrap(): Promise<void> {
  // rawBody is needed to verify Discord's Ed25519 request signature in
  // DiscordInteractionsController — it doesn't disable normal JSON body
  // parsing, just also exposes the untouched bytes as `req.rawBody`.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const configService = app.get(ConfigService);

  app.setGlobalPrefix('api');

  const corsOrigin = configService.get<string>('CORS_ORIGIN');
  app.enableCors({
    origin: corsOrigin ? corsOrigin.split(',').map((origin) => origin.trim()) : true,
  });

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);
  Logger.log(`assistant-api listening on port ${port}`, 'Bootstrap');

  // On a single instance the background worker can live in this process.
  if (configService.get<string>('WORKER_IN_PROCESS') === 'true') {
    app.enableShutdownHooks();
    await app.get(WorkerService).start();
  }
}

bootstrap().catch((error: unknown) => {
  Logger.error('Failed to bootstrap application', error instanceof Error ? error.stack : error);
  process.exit(1);
});
