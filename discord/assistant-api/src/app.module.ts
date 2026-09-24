import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AuthModule } from './auth/auth.module';
import { BotModule } from './bot/bot.module';
import { DiscordBotModule } from './discord/discord-bot.module';
import { HoneypotModule } from './honeypot/honeypot.module';
import { TasksModule } from './tasks/tasks.module';
import { WorkerModule } from './worker/worker.module';
import { CharactersModule } from './characters/characters.module';
import { DatabaseModule } from './database/database.module';
import { GuildsModule } from './guilds/guilds.module';
import { RealtimeModule } from './realtime/realtime.module';
import { OfficerRequestsModule } from './officer-requests/officer-requests.module';
import { PlayersModule } from './players/players.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Serves the built assistant-backoffice SPA. Populated at
    // `public/` by the Docker build; excluded from `/api` so it never
    // shadows the REST endpoints below.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: ['/api/{*splat}'],
    }),
    DatabaseModule,
    DiscordBotModule,
    AuthModule,
    BotModule,
    PlayersModule,
    CharactersModule,
    GuildsModule,
    RealtimeModule,
    TasksModule,
    HoneypotModule,
    OfficerRequestsModule,
    WorkerModule,
  ],
})
export class AppModule {}
