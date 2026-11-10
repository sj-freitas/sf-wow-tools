import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { UploadKeyGuard } from '../upload-keys/upload-key.guard';
import {
  ProfessionsUploadService,
  type UploaderDto,
  type UploadResultDto,
} from './professions-upload.service';

/**
 * The Guild Assistant Uploader's endpoints: an upload key (`Authorization: Bearer gak_…`), not
 * the login cookie. Nothing else takes an upload key.
 */
@Controller('upload')
@UseGuards(UploadKeyGuard)
export class ProfessionsUploadController {
  constructor(private readonly uploads: ProfessionsUploadService) {}

  /** Whose key it is and where uploads go: the uploader checks a key with it. */
  @Get('me')
  me(@Req() req: AuthenticatedRequest): Promise<UploaderDto> {
    return this.uploads.whoAmI(req.user);
  }

  /** `{ data }`: the addon's file (GuildAssistantProfessions.lua) as the game wrote it. */
  @Post('professions')
  @HttpCode(HttpStatus.OK)
  upload(
    @Req() req: AuthenticatedRequest,
    @Body() body: { data?: unknown },
  ): Promise<UploadResultDto> {
    return this.uploads.upload(req.user, body.data);
  }
}
