import { SetMetadata } from '@nestjs/common';

export const COMMAND_METADATA = 'command_metadata';
export const COMMAND_OPTIONS_METADATA = 'command_options_metadata';

export interface CommandOptions {
  /** Reply is only visible to the user who invoked the command. */
  ephemeral?: boolean;
  /**
   * The handler may take longer than Discord's 3 seconds: answer "thinking…" at once and show the
   * handler's text when it is done.
   */
  defer?: boolean;
}

/**
 * Marks a provider method as the handler for a Discord slash command.
 * `name` must match a `name` entry in `src/bot/commands.json`, the source
 * of truth used to register commands with Discord.
 */
export const Command =
  (name: string, options: CommandOptions = {}): MethodDecorator =>
  (target, propertyKey, descriptor) => {
    SetMetadata(COMMAND_METADATA, name)(target, propertyKey, descriptor);
    SetMetadata(COMMAND_OPTIONS_METADATA, options)(target, propertyKey, descriptor);
  };
