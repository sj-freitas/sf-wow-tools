import { Module } from '@nestjs/common';
import { ArmoryCoreModule } from '../armory/armory-core.module';
import { AuthModule } from '../auth/auth.module';
import { CharactersModule } from '../characters/characters.module';
import { BattleNetController } from './battlenet.controller';
import { BattleNetService } from './battlenet.service';

/** "Verify with Battle.net" on a character's page: a pass marks the character verified. */
@Module({
  imports: [AuthModule, ArmoryCoreModule, CharactersModule],
  controllers: [BattleNetController],
  providers: [BattleNetService],
})
export class BattleNetModule {}
