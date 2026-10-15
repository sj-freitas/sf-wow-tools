import { readFileSync } from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';
import { DiscordBotService } from '../discord/discord-bot.service';
import { MARKER_NAMES } from '../game/class-icons';
import { classIcon, getGame, markerIcon } from '../game/games';
import { colorDotPng } from './color-dot';

/** After a failure (no application id, Discord refusing), try again only this much later. */
const RETRY_MS = 10 * 60 * 1000;

/** `name` is what Discord needs to show it (`<:name:id>`); `id` for select menu options. */
export interface ClassEmoji {
  name: string;
  id: string;
}

/** Turns a class into its emoji (icon or colour dot); null when there is none (unknown class, or no emoji). */
export type ClassEmojiOf = (className: string | null) => ClassEmoji | null;

/** `<:name:id>` for message text. */
export const emojiText = (emoji: ClassEmoji | null): string =>
  emoji ? `<:${emoji.name}:${emoji.id}>` : '';

/**
 * Game pictures as Discord emojis — the raid markers (`markersFor`), and each class as an emoji, uploaded once to the bot's application (usable in every server):
 * its icon (`class-icons/<Class>.png` in the version's folder) when it has one, else a round dot
 * in its colour (`classes.<name>.color`). The name carries the image's hash or the colour
 * (`i_druid_3fa2b19c`, `c_druid_ff7c0a`), so a new icon or colour is uploaded as a new emoji.
 * Discord can't colour text, so this is how sign-ups show the class.
 */
@Injectable()
export class ClassEmojiService {
  private readonly logger = new Logger(ClassEmojiService.name);
  /** Emoji name -> id, of the application's emojis. */
  private known: Map<string, string> | null = null;
  private failedAt = 0;
  private pending: Promise<void> | null = null;

  constructor(private readonly discord: DiscordBotService) {}

  /** The emojis of a game version's classes, uploading any missing ones first. Never throws. */
  async forGame(gameVersion: string): Promise<ClassEmojiOf> {
    const wanted = new Map<string, string>(); // class -> emoji name
    const images = new Map<string, () => EmojiImage>(); // emoji name -> its image
    for (const [className, config] of Object.entries(getGame(gameVersion)?.classes ?? {})) {
      const icon = classIcon(gameVersion, className);
      if (icon) {
        const name = iconEmojiName(className, icon.hash);
        wanted.set(className, name);
        images.set(name, () => ({ data: readFileSync(icon.file), contentType: icon.contentType }));
      } else if (config.color) {
        const color = config.color;
        const name = emojiName(className, color);
        wanted.set(className, name);
        images.set(name, () => ({ data: colorDotPng(color), contentType: 'image/png' }));
      }
    }
    await this.ensure(images);
    return (className) => {
      const name = className ? wanted.get(className) : undefined;
      const id = name ? this.known?.get(name) : undefined;
      return name && id ? { name, id } : null;
    };
  }

  /**
   * The raid marker icons of a game version (`raid-markers/<Marker>.png`) as emojis, by marker
   * name (`Skull`); null for a marker without an icon. Never throws.
   */
  async markersFor(gameVersion: string): Promise<(marker: string) => ClassEmoji | null> {
    const wanted = new Map<string, string>(); // marker -> emoji name
    const images = new Map<string, () => EmojiImage>();
    for (const marker of MARKER_NAMES) {
      const icon = markerIcon(gameVersion, marker);
      if (!icon) continue;
      const name = `m_${slug(marker)}_${icon.hash}`;
      wanted.set(marker, name);
      images.set(name, () => ({ data: readFileSync(icon.file), contentType: icon.contentType }));
    }
    await this.ensure(images);
    return (marker) => {
      const name = wanted.get(marker);
      const id = name ? this.known?.get(name) : undefined;
      return name && id ? { name, id } : null;
    };
  }

  private async ensure(images: Map<string, () => EmojiImage>): Promise<void> {
    if (Date.now() - this.failedAt < RETRY_MS) return;
    // One upload round at a time; callers meanwhile wait for it.
    while (this.pending) await this.pending;
    if (this.known && [...images.keys()].every((name) => this.known?.has(name))) return;
    this.pending = (async () => {
      try {
        this.known ??= new Map(
          (await this.discord.listApplicationEmojis()).map((emoji) => [emoji.name, emoji.id]),
        );
        for (const [name, image] of images) {
          if (this.known.has(name)) continue;
          const { data, contentType } = image();
          const created = await this.discord.createApplicationEmoji(name, data, contentType);
          this.known.set(created.name, created.id);
        }
      } catch (error) {
        this.failedAt = Date.now();
        this.logger.warn(`Class emojis unavailable: ${String(error)}`);
      } finally {
        this.pending = null;
      }
    })();
    await this.pending;
  }
}

interface EmojiImage {
  data: Buffer;
  contentType: string;
}

const slug = (className: string): string =>
  className
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 20);

/** A class's icon: `Druid` + its file's hash -> `i_druid_3fa2b19c`. */
export const iconEmojiName = (className: string, hash: string): string =>
  `i_${slug(className)}_${hash}`;

/** `Death Knight`, `#C41E3A` -> `c_deathknight_c41e3a` (Discord: 2-32 of a-z, 0-9, _). */
export const emojiName = (className: string, color: string): string =>
  `c_${className.toLowerCase().replace(/[^a-z0-9]/g, '')}`.slice(0, 24) +
  `_${color.slice(1).toLowerCase()}`;
