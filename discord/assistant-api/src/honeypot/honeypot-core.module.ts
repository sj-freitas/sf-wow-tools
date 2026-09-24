import { Module } from '@nestjs/common';
import { HoneypotEnforcerService } from './honeypot-enforcer.service';
import { HoneypotGatewayService } from './honeypot-gateway.service';
import { HoneypotService } from './honeypot.service';

/** Honeypot logic that needs only the database and the bot (no HTTP, no login). */
@Module({
  providers: [HoneypotService, HoneypotEnforcerService, HoneypotGatewayService],
  exports: [HoneypotService, HoneypotEnforcerService, HoneypotGatewayService],
})
export class HoneypotCoreModule {}
