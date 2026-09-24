import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HoneypotCoreModule } from './honeypot-core.module';
import { HoneypotController } from './honeypot.controller';

@Module({
  imports: [AuthModule, HoneypotCoreModule],
  controllers: [HoneypotController],
})
export class HoneypotModule {}
