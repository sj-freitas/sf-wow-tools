import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfessionsCommand } from './professions.command';
import { CharacterProfessionsController, ProfessionsController } from './professions.controller';
import { ProfessionsCoreModule } from './professions-core.module';
import { ProfessionsService } from './professions.service';

/**
 * Characters' professions, imported from the GuildAssistant Professions addon, with recipe names
 * from Wowhead. Its own folder and tables (prisma/professions.prisma).
 */
@Module({
  imports: [AuthModule, ProfessionsCoreModule],
  controllers: [ProfessionsController, CharacterProfessionsController],
  providers: [ProfessionsService, ProfessionsCommand],
})
export class ProfessionsModule {}
