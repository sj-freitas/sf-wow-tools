import { Global, Module } from '@nestjs/common';
import { DiscordBotService } from './discord-bot.service';

@Global()
@Module({
  providers: [DiscordBotService],
  exports: [DiscordBotService],
})
export class DiscordBotModule {}
