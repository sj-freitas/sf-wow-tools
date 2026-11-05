import { Module } from '@nestjs/common';
import { ArmorySyncService } from './armory-sync.service';
import { ArmoryService } from './armory.service';

/** The armory itself and its background sync, for the API and the worker alike. */
@Module({
  providers: [ArmoryService, ArmorySyncService],
  exports: [ArmoryService, ArmorySyncService],
})
export class ArmoryCoreModule {}
