import { SetMetadata } from '@nestjs/common';

export const COMMAND_METADATA = 'command_metadata';

/**
 * Marks a provider method as the handler for a Discord slash command.
 * `name` must match a `name` entry in `src/bot/commands.json`, the source
 * of truth used to register commands with Discord.
 */
export const Command = (name: string): MethodDecorator => SetMetadata(COMMAND_METADATA, name);
