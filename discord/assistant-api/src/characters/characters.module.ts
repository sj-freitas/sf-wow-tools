import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CharactersAdminController } from './characters-admin.controller';
import { CharactersCommand } from './characters.command';
import { CharactersService } from './characters.service';

@Module({
  imports: [AuthModule],
  controllers: [CharactersAdminController],
  providers: [CharactersService, CharactersCommand],
})
export class CharactersModule {}
