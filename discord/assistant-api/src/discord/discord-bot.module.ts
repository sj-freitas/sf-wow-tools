import { Global, Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module';
import { ClassEmojiService } from './class-emojis.service';
import { DiscordBotService } from './discord-bot.service';

@Global()
@Module({
  // The bot keeps some Discord answers (channel lists) for a while.
  imports: [CacheModule],
  // ClassEmojiService: the game's icons (classes, roles, raid markers) as the bot's own emojis,
  // for sign-up posts and post tags alike.
  providers: [DiscordBotService, ClassEmojiService],
  exports: [DiscordBotService, ClassEmojiService],
})
export class DiscordBotModule {}
