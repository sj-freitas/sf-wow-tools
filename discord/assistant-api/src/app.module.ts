import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AuthModule } from './auth/auth.module';
import { BotModule } from './bot/bot.module';
import { CharactersModule } from './characters/characters.module';
import { DatabaseModule } from './database/database.module';
import { GuildsModule } from './guilds/guilds.module';
import { RealtimeModule } from './realtime/realtime.module';
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
    AuthModule,
    BotModule,
    PlayersModule,
    CharactersModule,
    GuildsModule,
    RealtimeModule,
  ],
})
export class AppModule {}
