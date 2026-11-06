import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SessionUser } from '../auth/auth.types';
import { McpToolRegistry, toolResult } from '../mcp/mcp-tool-registry';
import { ArmoryLookupService } from './armory-lookup.service';

/**
 * The armory in the MCP server (`/api/mcp`): a character's race, class, level and specs as
 * Blizzard has them now, like "Load from armory" (`ArmoryLookupService`). Registered from here so
 * the MCP module doesn't depend on the armory.
 */
@Injectable()
export class ArmoryMcpTools implements OnModuleInit {
  constructor(
    private readonly registry: McpToolRegistry,
    private readonly lookup: ArmoryLookupService,
  ) {}

  onModuleInit(): void {
    this.registry.add((server, user) => this.register(server, user));
  }

  register(server: McpServer, user: SessionUser): void {
    server.registerTool(
      'look_up_armory',
      {
        title: 'Look up in the armory',
        description:
          "A character in the official armory of the guild's game version and region (live from Blizzard, which can lag behind the game): its race, class, level, faction and talents, and its specs and roles worked out from the talents (EXPERIMENTAL: `guessed` when the talents say nothing). The roster itself doesn't store specs. Members of the guild.",
        inputSchema: {
          guildId: z.string().describe('The guild id, from list_guilds'),
          name: z.string().describe("The character's name"),
          lastName: z
            .string()
            .optional()
            .describe('Its last name, for game versions with last names (Forever)'),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      (args) =>
        toolResult(() =>
          this.lookup.forGuild(user.id, args.guildId, args.name, args.lastName ?? ''),
        ),
    );
  }
}
