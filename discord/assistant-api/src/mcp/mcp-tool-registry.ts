import { HttpException, Injectable, Module } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { SessionUser } from '../auth/auth.types';

/** Adds a feature's tools to a server that acts as `user`. */
export type McpToolsContributor = (server: McpServer, user: SessionUser) => void;

/**
 * Where features add their own MCP tools (e.g. event sign-ups, in `src/signup/`), so the MCP
 * module doesn't depend on them and a feature taken out takes its tools with it. A feature
 * imports `McpToolRegistryModule` and calls `add` when it starts (`onModuleInit`).
 */
@Injectable()
export class McpToolRegistry {
  private readonly contributors: McpToolsContributor[] = [];

  add(contributor: McpToolsContributor): void {
    this.contributors.push(contributor);
  }

  apply(server: McpServer, user: SessionUser): void {
    for (const contribute of this.contributors) contribute(server, user);
  }
}

@Module({ providers: [McpToolRegistry], exports: [McpToolRegistry] })
export class McpToolRegistryModule {}

/** A tool's result as JSON text; the API's own errors (forbidden, invalid input, …) as tool errors. */
export async function toolResult(action: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const result = await action();
    return { content: [{ type: 'text', text: JSON.stringify(result ?? { ok: true }, null, 2) }] };
  } catch (error) {
    if (error instanceof HttpException) {
      return { isError: true, content: [{ type: 'text', text: messageOf(error) }] };
    }
    throw error;
  }
}

function messageOf(error: HttpException): string {
  const response = error.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join('; ');
  return typeof message === 'string' ? message : error.message;
}
