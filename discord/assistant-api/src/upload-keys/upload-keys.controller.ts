import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { UploadKeysService, type UploadKeyDto } from './upload-keys.service';

/** The Upload keys page: the logged-in player's own keys. */
@Controller('upload-keys')
@UseGuards(AuthGuard)
export class UploadKeysController {
  constructor(private readonly keys: UploadKeysService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest): Promise<UploadKeyDto[]> {
    return this.keys.list(req.user.id);
  }

  /** `{ name }`: the answer holds the key itself, the only time it is shown. */
  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Body() body: { name?: unknown },
  ): Promise<UploadKeyDto & { key: string }> {
    return this.keys.create(req.user.id, body.name);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.keys.delete(req.user.id, id);
  }
}
