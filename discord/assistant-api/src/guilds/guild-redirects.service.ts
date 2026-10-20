import { Injectable, Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { PrismaService } from '../database/prisma.service';
import { guildPath } from './guild-path';

/** `/<version>/<region>/<realm>/guilds/<name>` and whatever follows (a page of the guild). */
const GUILD_ADDRESS = /^\/([^/]+)\/([^/]+)\/([^/]+)\/guilds\/([^/?#]+)(\/[^?#]*)?$/;

/**
 * Old guild addresses (from before a rename, or a realm, region or game version change) lead to
 * the guild's address now. A temporary redirect (302): the old address may one day belong to
 * another guild, and a browser would remember a permanent one.
 */
@Injectable()
export class GuildRedirectsService {
  private readonly logger = new Logger(GuildRedirectsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** The guild's address now, for an old address of it (`a/b/c/guilds/d`); null otherwise. */
  async resolve(path: string): Promise<string | null> {
    const alias = await this.prisma.guildPathAlias.findUnique({
      where: { path: path.toLowerCase() },
      select: { guild: { select: { gameVersion: true, region: true, realm: true, name: true } } },
    });
    return alias ? guildPath(alias.guild) : null;
  }

  /**
   * Express middleware for page loads (a link from Discord, a bookmark): an old guild address is
   * redirected, with the same page of the guild and query. Anything else goes on untouched.
   */
  readonly middleware = (req: Request, res: Response, next: NextFunction): void => {
    const match = req.method === 'GET' ? GUILD_ADDRESS.exec(req.path) : null;
    if (!match) return next();
    const [, version, region, realm, name, rest = ''] = match;
    this.resolve([version, region, realm, 'guilds', name].join('/'))
      .then((current) => {
        if (!current) return next();
        const query = req.originalUrl.includes('?')
          ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
          : '';
        res.redirect(302, `/${current}${rest}${query}`);
      })
      .catch((error: unknown) => {
        this.logger.warn(`Could not look up ${req.path}: ${String(error)}`);
        next();
      });
  };
}
