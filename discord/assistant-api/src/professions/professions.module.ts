import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfessionsCommand } from './professions.command';
import { CharacterProfessionsController, ProfessionsController } from './professions.controller';
import { ProfessionsCoreModule } from './professions-core.module';
import { ProfessionsUploadController } from './professions-upload.controller';
import { ProfessionsUploadService } from './professions-upload.service';
import { ProfessionsService } from './professions.service';
import { RecipeSourcesController, RecipeSourcesService } from './recipe-sources.service';
import { UploadKeysModule } from '../upload-keys/upload-keys.module';

/**
 * Characters' professions, imported from the GuildAssistant Professions addon (by hand, or by the
 * Guild Assistant Uploader with an upload key), with recipe names from Wowhead. Its own folder and
 * tables (prisma/professions.prisma).
 */
@Module({
  imports: [AuthModule, ProfessionsCoreModule, UploadKeysModule],
  controllers: [
    ProfessionsController,
    CharacterProfessionsController,
    ProfessionsUploadController,
    RecipeSourcesController,
  ],
  providers: [
    ProfessionsService,
    ProfessionsCommand,
    ProfessionsUploadService,
    RecipeSourcesService,
  ],
})
export class ProfessionsModule {}
