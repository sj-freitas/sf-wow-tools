import { join } from 'node:path';
import type { Response } from 'express';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AuthModule } from './auth/auth.module';
import { BotModule } from './bot/bot.module';
import { CacheModule } from './cache/cache.module';
import { DiscordBotModule } from './discord/discord-bot.module';
import { HoneypotModule } from './honeypot/honeypot.module';
import { PluginsModule } from './plugins/plugins.module';
import { TasksModule } from './tasks/tasks.module';
import { WorkerModule } from './worker/worker.module';
import { CharactersModule } from './characters/characters.module';
import { DatabaseModule } from './database/database.module';
import { GuildsModule } from './guilds/guilds.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ModerationModule } from './moderation/moderation.module';
import { ArmoryModule } from './armory/armory.module';
import { BattleNetModule } from './battlenet/battlenet.module';
import { OfficerRequestsModule } from './officer-requests/officer-requests.module';
import { PlayersModule } from './players/players.module';
import { PublicModule } from './public/public.module';
import { SignupModule } from './signup/signup.module';
import { McpModule } from './mcp/mcp.module';
import { ProfessionsModule } from './professions/professions.module';
import { ProblemsModule } from './problems/problems.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Serves the built assistant-backoffice SPA. Populated at
    // `public/` by the Docker build; excluded from `/api` so it never
    // shadows the REST endpoints below.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: ['/api/{*splat}'],
      serveStaticOptions: {
        // The page is checked for a new version every time; the built files under assets/ are
        // named by their contents (a new version has new names), so they can be kept for good.
        setHeaders: (res: Response, path: string) => {
          res.setHeader(
            'Cache-Control',
            /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache',
          );
        },
      },
    }),
    DatabaseModule,
    CacheModule,
    DiscordBotModule,
    AuthModule,
    BotModule,
    PublicModule,
    PlayersModule,
    CharactersModule,
    GuildsModule,
    RealtimeModule,
    TasksModule,
    HoneypotModule,
    PluginsModule,
    OfficerRequestsModule,
    ModerationModule,
    ArmoryModule,
    BattleNetModule,
    SignupModule,
    McpModule,
    ProfessionsModule,
    ProblemsModule,
    WorkerModule,
  ],
})
export class AppModule {}
