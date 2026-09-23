import { Injectable, Logger } from '@nestjs/common';
import type { DiscordInteraction } from './discord-interaction.types';
import type { CommandOptions } from './decorators/command.decorator';

export interface CommandHandlerRef {
  instance: object;
  methodName: string;
  options: CommandOptions;
}

export type CommandHandlerFn = (interaction: DiscordInteraction) => Promise<string> | string;

/**
 * Holds the runtime mapping of command name -> handler, populated by
 * CommandExplorerService. This is the "router" in the HTTP-controller
 * analogy — the interactions controller looks up and invokes handlers here.
 */
@Injectable()
export class CommandRegistryService {
  private readonly logger = new Logger(CommandRegistryService.name);
  private readonly handlers = new Map<string, CommandHandlerRef>();

  register(name: string, instance: object, methodName: string, options: CommandOptions = {}): void {
    if (this.handlers.has(name)) {
      throw new Error(
        `Command "${name}" is already registered to ${this.handlers.get(name)?.instance.constructor.name}`,
      );
    }
    this.logger.log(`Registered command "${name}" -> ${instance.constructor.name}#${methodName}`);
    this.handlers.set(name, { instance, methodName, options });
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  isEphemeral(name: string): boolean {
    return this.handlers.get(name)?.options.ephemeral ?? false;
  }

  getCommandNames(): string[] {
    return [...this.handlers.keys()];
  }

  async execute(name: string, interaction: DiscordInteraction): Promise<string> {
    const handler = this.handlers.get(name);
    if (!handler) {
      throw new Error(`No handler registered for command "${name}"`);
    }
    const fn = (handler.instance as Record<string, CommandHandlerFn>)[handler.methodName];
    return fn.call(handler.instance, interaction);
  }
}
