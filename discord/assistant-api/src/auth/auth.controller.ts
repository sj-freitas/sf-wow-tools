import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { AuthGuard, SESSION_COOKIE } from './auth.guard';
import { AuthService, SESSION_TTL_MS } from './auth.service';
import type { AuthenticatedRequest, SessionUser } from './auth.types';
import { readCookie } from './cookies';
import { DiscordOAuthService } from './discord-oauth.service';

const STATE_COOKIE = 'oauth_state';

@Controller('auth')
export class AuthController {
  private readonly cookieOptions: CookieOptions;

  constructor(
    private readonly authService: AuthService,
    private readonly discord: DiscordOAuthService,
  ) {
    this.cookieOptions = {
      httpOnly: true,
      sameSite: 'lax',
      secure: discord.redirectUri.startsWith('https://'),
      path: '/',
    };
  }

  @Get('login')
  login(@Res() res: Response, @Query('prompt') prompt?: string): void {
    const state = randomBytes(16).toString('base64url');
    res.cookie(STATE_COOKIE, state, { ...this.cookieOptions, maxAge: 10 * 60 * 1000 });
    res.redirect(this.discord.buildAuthorizeUrl(state, prompt === 'consent' ? 'consent' : 'none'));
  }

  @Get('callback')
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    // `prompt=none` fails for users who haven't yet approved the requested scopes.
    if (error === 'consent_required') {
      res.redirect('/api/auth/login?prompt=consent');
      return;
    }
    const expectedState = readCookie(req, STATE_COOKIE);
    if (!code || !state || !expectedState || !statesMatch(state, expectedState)) {
      throw new UnauthorizedException('Invalid login state');
    }

    const token = await this.authService.loginWithCode(code);
    res.clearCookie(STATE_COOKIE, this.cookieOptions);
    res.cookie(SESSION_COOKIE, token, { ...this.cookieOptions, maxAge: SESSION_TTL_MS });
    res.redirect('/');
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() req: AuthenticatedRequest): SessionUser {
    return req.user;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) {
      await this.authService.logout(token);
    }
    res.clearCookie(SESSION_COOKIE, this.cookieOptions);
  }
}

function statesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
