import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { COMMAND_METADATA } from './decorators/command.decorator';
import { CommandRegistryService } from './command-registry.service';

/**
 * Scans every provider in the DI container for methods decorated with
 * @Command(...) and registers them with the CommandRegistryService.
 * This is the non-HTTP-routing equivalent of Nest's route explorer —
 * dispatch happens on Discord command name instead of HTTP verb + path.
 */
@Injectable()
export class CommandExplorerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CommandExplorerService.name);

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly commandRegistry: CommandRegistryService,
  ) {}

  onApplicationBootstrap(): void {
    const providers = this.discoveryService.getProviders();

    for (const wrapper of providers) {
      const instance: unknown = wrapper.instance;
      if (!instance || typeof instance !== 'object') {
        continue;
      }

      const prototype = Object.getPrototypeOf(instance) as object | null;
      if (!prototype) {
        continue;
      }

      this.metadataScanner
        .getAllMethodNames(prototype)
        .forEach((methodName) => this.registerIfCommand(instance, prototype, methodName));
    }

    this.logger.log(`Discovered ${this.commandRegistry.getCommandNames().length} command(s)`);
  }

  private registerIfCommand(instance: object, prototype: object, methodName: string): void {
    const method = (prototype as Record<string, unknown>)[methodName];
    if (typeof method !== 'function') {
      return;
    }

    const commandName = this.reflector.get<string | undefined>(COMMAND_METADATA, method);
    if (!commandName) {
      return;
    }

    this.commandRegistry.register(commandName, instance, methodName);
  }
}
