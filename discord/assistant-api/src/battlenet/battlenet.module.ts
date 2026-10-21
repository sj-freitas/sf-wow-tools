import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BattleNetController } from './battlenet.controller';
import { BattleNetService } from './battlenet.service';

/** "Verify with Battle.net" on a character's page (a preview for now: see BattleNetService). */
@Module({
  imports: [AuthModule],
  controllers: [BattleNetController],
  providers: [BattleNetService],
})
export class BattleNetModule {}
