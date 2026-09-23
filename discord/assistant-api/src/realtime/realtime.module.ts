import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventsController } from './events.controller';
import { RealtimeService } from './realtime.service';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [EventsController],
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
