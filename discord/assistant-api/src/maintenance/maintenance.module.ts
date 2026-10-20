import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service';

/** Housekeeping the worker runs on its own (deleting old history). */
@Module({
  providers: [RetentionService],
  exports: [RetentionService],
})
export class MaintenanceModule {}
