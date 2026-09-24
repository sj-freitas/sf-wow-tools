import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConversationsService } from './conversations.service';
import { OfficerRequestsCommand } from './officer-requests.command';
import { OfficerRequestsController } from './officer-requests.controller';
import { OfficerRequestsService } from './officer-requests.service';

@Module({
  imports: [AuthModule],
  controllers: [OfficerRequestsController],
  providers: [OfficerRequestsService, ConversationsService, OfficerRequestsCommand],
})
export class OfficerRequestsModule {}
