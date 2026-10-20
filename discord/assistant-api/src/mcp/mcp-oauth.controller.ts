import { createHash, timingSafeEqual } from 'node:crypto';
import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SESSION_COOKIE } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { readCookie } from '../auth/cookies';
import { type ConsentRequest, McpOAuthProvider } from './mcp-oauth.provider';

/**
 * The page where a user approves connecting an MCP client (Claude, an IDE, …) to their account.
 * Not logged in: off to the Discord login, which comes back here.
 */
@Controller('mcp-oauth')
export class McpOAuthController {
  constructor(
    private readonly oauth: McpOAuthProvider,
    private readonly auth: AuthService,
  ) {}

  @Get('consent')
  async show(
    @Req() req: Request,
    @Res() res: Response,
    @Query('request') sealed?: string,
  ): Promise<void> {
    const request = sealed ? this.oauth.openConsent(sealed) : undefined;
    if (!sealed || !request) {
      sendPage(res, 400, 'This link has expired', '<p>Start connecting again from your app.</p>');
      return;
    }
    const session = readCookie(req, SESSION_COOKIE);
    const user = session ? await this.auth.findUserBySessionToken(session) : null;
    if (!session || !user) {
      res.redirect(`/api/auth/login?next=${encodeURIComponent(req.originalUrl)}`);
      return;
    }
    sendPage(
      res,
      200,
      `Connect ${escapeHtml(request.clientName)}?`,
      `<p><strong>${escapeHtml(request.clientName)}</strong> wants to use Guild Assistant as
        <strong>${escapeHtml(user.displayName)}</strong>.</p>
      <p>It will be able to do what you can do in the backoffice: see your guilds and their
        rosters and, where you are an Officer, read and change posts and plugins.</p>
      <p class="muted">It stays connected for up to a week, then asks you to connect again.</p>
      <p class="muted">You will be sent back to <code>${escapeHtml(originOf(request.redirectUri))}</code>.</p>
      <form method="post">
        <input type="hidden" name="request" value="${escapeHtml(sealed)}">
        <input type="hidden" name="csrf" value="${csrfFor(session, sealed)}">
        <button name="decision" value="allow" class="primary">Allow</button>
        <button name="decision" value="deny">Cancel</button>
      </form>`,
    );
  }

  @Post('consent')
  async decide(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: { request?: string; csrf?: string; decision?: string },
  ): Promise<void> {
    const sealed = body.request ?? '';
    const request = this.oauth.openConsent(sealed);
    const session = readCookie(req, SESSION_COOKIE);
    if (!request || !session || !csrfMatches(body.csrf, csrfFor(session, sealed))) {
      sendPage(res, 400, 'This link has expired', '<p>Start connecting again from your app.</p>');
      return;
    }
    if (body.decision !== 'allow') {
      res.redirect(redirectWith(request, { error: 'access_denied' }));
      return;
    }
    try {
      const code = await this.oauth.issueCode(request, session);
      res.redirect(redirectWith(request, { code }));
    } catch {
      res.redirect(`/api/auth/login?next=${encodeURIComponent(this.oauth.consentUrl(request))}`);
    }
  }
}

function redirectWith(request: ConsentRequest, params: Record<string, string>): string {
  const url = new URL(request.redirectUri);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (request.state !== undefined) url.searchParams.set('state', request.state);
  return url.href;
}

/** Ties the form to the logged-in session (on top of the SameSite session cookie). */
const csrfFor = (session: string, sealed: string): string =>
  createHash('sha256').update(`${session}:${sealed}`).digest('hex');

function csrfMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function originOf(uri: string): string {
  try {
    const url = new URL(uri);
    return url.origin === 'null' ? `${url.protocol}//` : url.origin;
  } catch {
    return uri;
  }
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function sendPage(res: Response, status: number, title: string, body: string): void {
  res.status(status).set({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    // No form-action: approving redirects to the app, which may use its own scheme (vscode://).
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
  }).send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Guild Assistant</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f6f8; --card: #fff; --text: #1b1b20; --muted: #6b6b76; --accent: #7c5cff; --border: #dcdce3; }
  @media (prefers-color-scheme: dark) { :root { --bg: #131217; --card: #1d1c23; --text: #ececf1; --muted: #9a9aa6; --border: #2e2d36; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; box-sizing: border-box; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 440px; width: 100%; padding: 24px; border: 1px solid var(--border); border-radius: 12px; background: var(--card); }
  h1 { margin: 0 0 12px; font-size: 1.25rem; }
  .muted { color: var(--muted); font-size: 0.9rem; }
  form { display: flex; gap: 8px; margin-top: 20px; }
  button { flex: 1; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
  button.primary { border-color: var(--accent); background: var(--accent); color: #fff; }
</style>
</head>
<body><main><h1>${title}</h1>${body}</main></body>
</html>`);
}
