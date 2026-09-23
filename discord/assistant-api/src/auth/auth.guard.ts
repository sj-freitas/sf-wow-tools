import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';
import { readCookie } from './cookies';

export const SESSION_COOKIE = 'session';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = readCookie(req, SESSION_COOKIE);
    const user = token ? await this.authService.findUserBySessionToken(token) : null;
    if (!token || !user) {
      throw new UnauthorizedException('Not logged in');
    }
    await this.authService.refreshIfStale(token);
    (req as AuthenticatedRequest).user = user;
    (req as AuthenticatedRequest).sessionToken = token;
    return true;
  }
}
