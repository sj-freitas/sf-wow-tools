import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { UploadKeysService } from './upload-keys.service';

/**
 * For the uploader's endpoints only (src/professions/professions-upload.controller.ts): an upload
 * key in `Authorization: Bearer gak_…` instead of the login cookie. `req.user` is its player.
 */
@Injectable()
export class UploadKeyGuard implements CanActivate {
  constructor(private readonly keys: UploadKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const [scheme, key] = (req.headers.authorization ?? '').split(' ');
    const user = scheme === 'Bearer' && key ? await this.keys.userOf(key.trim()) : null;
    if (!user) {
      throw new UnauthorizedException(
        'That upload key doesn’t work (deleted, or mistyped): make a new one on Guild Assistant, Upload keys.',
      );
    }
    (req as AuthenticatedRequest).user = user;
    return true;
  }
}
