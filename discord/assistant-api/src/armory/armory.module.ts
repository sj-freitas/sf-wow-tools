import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ArmoryController } from './armory.controller';
import { ArmoryService } from './armory.service';

@Module({
  imports: [AuthModule],
  controllers: [ArmoryController],
  providers: [ArmoryService],
  exports: [ArmoryService],
})
export class ArmoryModule {}
