import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ArmoryCoreModule } from './armory-core.module';
import { ArmoryController } from './armory.controller';

@Module({
  imports: [AuthModule, ArmoryCoreModule],
  controllers: [ArmoryController],
  exports: [ArmoryCoreModule],
})
export class ArmoryModule {}
