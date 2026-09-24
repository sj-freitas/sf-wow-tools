import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { DiscordBotModule } from './discord/discord-bot.module';
import { WorkerModule } from './worker/worker.module';
import { WorkerService } from './worker/worker.service';

/** Only what the worker needs: DATABASE_URL and DISCORD_TOKEN, no HTTP and no login. */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    DiscordBotModule,
    WorkerModule,
  ],
})
class WorkerAppModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerAppModule);
  app.enableShutdownHooks();
  await app.get(WorkerService).start();
  Logger.log('Worker running', 'Worker');
}

bootstrap().catch((error: unknown) => {
  Logger.error('Failed to start the worker', error instanceof Error ? error.stack : error);
  process.exit(1);
});
