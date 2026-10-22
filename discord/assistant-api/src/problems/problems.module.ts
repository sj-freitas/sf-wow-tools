import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProblemsController } from './problems.controller';
import { ProblemsService } from './problems.service';

/**
 * Guild problems (ProblemsService). Global: the posts, plugins, events and honeypots report to it
 * without importing it, and their tests work without it (they inject it as optional).
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [ProblemsController],
  providers: [ProblemsService],
  exports: [ProblemsService],
})
export class ProblemsModule {}
