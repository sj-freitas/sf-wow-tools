import { All, Controller, Logger, Req, Res } from '@nestjs/common';
import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { McpOAuthProvider } from './mcp-oauth.provider';
import { McpToolsService } from './mcp-tools.service';

/**
 * `/api/mcp`: the MCP server (Streamable HTTP, stateless: one server per request). The bearer
 * token is a session made when the user connected the client (see `McpOAuthProvider`); without
 * a valid one the 401 points the client at the OAuth metadata, which starts the Discord login.
 */
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);
  private readonly challenge: string;

  constructor(
    private readonly auth: AuthService,
    private readonly tools: McpToolsService,
    oauth: McpOAuthProvider,
  ) {
    const metadata = getOAuthProtectedResourceMetadataUrl(oauth.resourceUrl);
    this.challenge = `Bearer error="invalid_token", resource_metadata="${metadata}"`;
  }

  @All()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (req.method !== 'POST') {
      // Stateless: no server-initiated stream (GET) and no session to end (DELETE).
      res.status(405).set('Allow', 'POST').json(rpcError('Method not allowed.'));
      return;
    }
    const token = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1];
    const user = token ? await this.auth.findUserBySessionToken(token) : null;
    if (!token || !user) {
      this.unauthorized(res);
      return;
    }
    try {
      // Re-reads the user's servers and roles from Discord now and then, like the backoffice.
      await this.auth.refreshIfStale(token);
    } catch {
      this.unauthorized(res);
      return;
    }

    const server = this.tools.createServer(user);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      this.logger.error(`MCP request failed: ${String(error)}`);
      if (!res.headersSent) res.status(500).json(rpcError('Internal server error'));
    }
  }

  private unauthorized(res: Response): void {
    res.status(401).set('WWW-Authenticate', this.challenge).json(rpcError('Unauthorized'));
  }
}

const rpcError = (message: string) => ({
  jsonrpc: '2.0',
  error: { code: -32000, message },
  id: null,
});
