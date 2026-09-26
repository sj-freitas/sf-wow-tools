import { Injectable, Logger } from '@nestjs/common';
import type { ScheduledTask } from '@prisma/client';
import { DiscordBotService } from '../discord/discord-bot.service';
import { parseDynamicTokens, renderContent } from './dynamic-content';
import { PostImagesService } from './post-images.service';
import { liveMessageOf, type PostConfig, type PostedPart, type PostState } from './post-task';
import { TrackingService } from './tracking.service';

export interface SendOptions {
  /** Waits between messages (the worker sleeps; the backoffice does not wait). */
  wait?: (seconds: number) => Promise<void>;
  /** Called after each message is sent, with the state so far, so a failure keeps the progress. */
  onSent?: (state: PostState) => Promise<void>;
}

/** Sends the messages of a post to Discord, in order. */
@Injectable()
export class PostSenderService {
  private readonly logger = new Logger(PostSenderService.name);

  constructor(
    private readonly bot: DiscordBotService,
    private readonly tracking: TrackingService,
    private readonly images: PostImagesService,
  ) {}

  /**
   * Sends every part that is not in Discord yet, one after the other, and returns the new state.
   * A part sent before (and not deleted) is left alone, so after a failure the next attempt
   * continues where this one stopped instead of sending everything again.
   */
  async sendMissing(
    task: ScheduledTask,
    config: PostConfig,
    state: PostState,
    options: SendOptions = {},
  ): Promise<PostState> {
    let current: PostState = { messages: (state.messages ?? []).filter((m) => !m.deleted) };
    for (const [index, part] of config.parts.entries()) {
      if (liveMessageOf(current, part.id)) continue;
      if (index > 0 && part.delaySeconds > 0) await options.wait?.(part.delaySeconds);
      const posted = await this.sendPart(task, config, index);
      current = { messages: [...(current.messages ?? []), posted] };
      await options.onSent?.(current);
    }
    return current;
  }

  /** Renders one part (who reacted filled in), sends it with its images, and seeds its reactions. */
  async sendPart(task: ScheduledTask, config: PostConfig, index: number): Promise<PostedPart> {
    const part = config.parts[index];
    // Dynamic parts (who reacted to which post) are filled in as they are right now.
    const tokens = parseDynamicTokens(part.content, index + 1);
    const sources = await this.tracking.sourceMap(task.id, task.guildId, tokens);
    const people = await this.tracking.fetchPeople(task.guildId, tokens, sources);
    const rendered = await renderContent(part.content, tokens, people);
    const files = await this.images.files(part.imageIds);
    const messageId = await this.bot.postMessage(config.channelId, rendered, {
      suppressEmbeds: !part.embedLinks,
      files,
    });
    for (const emoji of part.seedReactions) {
      try {
        await this.bot.addReaction(config.channelId, messageId, emoji);
      } catch (error) {
        // The message is out; a missing seed reaction is not worth failing (and re-posting) for.
        this.logger.warn(`Could not add reaction ${emoji} to ${messageId}: ${String(error)}`);
      }
    }
    return {
      partId: part.id,
      messageId,
      channelId: config.channelId,
      serverId: config.serverId,
      postedAt: new Date().toISOString(),
      renderedContent: rendered,
      imageIds: part.imageIds,
      embedLinks: part.embedLinks,
    };
  }
}
