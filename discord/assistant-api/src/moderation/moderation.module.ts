import { Module } from '@nestjs/common';
import { ClearChannelCommand } from './clear-channel.command';
import { ClearChannelService } from './clear-channel.service';

@Module({ providers: [ClearChannelService, ClearChannelCommand] })
export class ModerationModule {}
