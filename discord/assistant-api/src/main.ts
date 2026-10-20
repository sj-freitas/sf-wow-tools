import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { AppModule } from './app.module';
import { GuildRedirectsService } from './guilds/guild-redirects.service';
import { McpOAuthProvider } from './mcp/mcp-oauth.provider';
import { WorkerService } from './worker/worker.service';

async function bootstrap(): Promise<void> {
  // rawBody is needed to verify Discord's Ed25519 request signature in
  // DiscordInteractionsController — it doesn't disable normal JSON body
  // parsing, just also exposes the untouched bytes as `req.rawBody`.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  const configService = app.get(ConfigService);

  app.setGlobalPrefix('api');
  // A professions export (every character of an account, src/professions) can pass the default
  // 100 kB.
  app.useBodyParser('json', { limit: '1mb' });
  // Old guild addresses (before a rename) redirect to the current one; registered before the
  // backoffice's static files, which are only set up when the app starts listening.
  app.use(app.get(GuildRedirectsService).middleware);
  // Render puts one proxy in front: client addresses (for the OAuth rate limits) come from it.
  app.set('trust proxy', 1);
  // OAuth for MCP clients (src/mcp): metadata under /.well-known and /authorize, /token,
  // /register, /revoke at the site's root, where clients look for them.
  const mcpOAuth = app.get(McpOAuthProvider);
  app.use(
    mcpAuthRouter({
      provider: mcpOAuth,
      issuerUrl: new URL(mcpOAuth.origin),
      resourceServerUrl: mcpOAuth.resourceUrl,
      resourceName: 'Guild Assistant',
    }),
  );

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
