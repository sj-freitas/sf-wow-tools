import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { BotModule } from './bot/bot.module';
import { DatabaseModule } from './database/database.module';
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
    BotModule,
    PlayersModule,
  ],
})
export class AppModule {}
