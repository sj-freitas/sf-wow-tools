import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CharacterBioController } from './character-bio.controller';
import { CharacterBioService } from './character-bio.service';
import { CharacterNotesController } from './character-notes.controller';
import { CharacterNotesService } from './character-notes.service';
import { CharactersAdminController } from './characters-admin.controller';
import { CharactersCommand } from './characters.command';
import { CharactersService } from './characters.service';

@Module({
  imports: [AuthModule],
  controllers: [CharactersAdminController, CharacterBioController, CharacterNotesController],
  providers: [CharactersService, CharactersCommand, CharacterBioService, CharacterNotesService],
})
export class CharactersModule {}
