import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { McpToolRegistryModule } from '../mcp/mcp-tool-registry';
import { ArmoryCoreModule } from './armory-core.module';
import { ArmoryLookupService } from './armory-lookup.service';
import { ArmoryMcpTools } from './armory-mcp-tools';
import { ArmoryController } from './armory.controller';

@Module({
  imports: [AuthModule, ArmoryCoreModule, McpToolRegistryModule],
  controllers: [ArmoryController],
  providers: [ArmoryLookupService, ArmoryMcpTools],
  exports: [ArmoryCoreModule],
})
export class ArmoryModule {}
