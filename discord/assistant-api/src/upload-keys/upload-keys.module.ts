import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UploadKeyGuard } from './upload-key.guard';
import { UploadKeysController } from './upload-keys.controller';
import { UploadKeysService } from './upload-keys.service';

/** Upload keys for the Guild Assistant Uploader (prisma/upload-keys.prisma). */
@Module({
  imports: [AuthModule],
  controllers: [UploadKeysController],
  providers: [UploadKeysService, UploadKeyGuard],
  exports: [UploadKeysService, UploadKeyGuard],
})
export class UploadKeysModule {}
