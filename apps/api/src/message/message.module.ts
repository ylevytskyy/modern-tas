import { Module } from '@nestjs/common';
import { MessageController } from './message.controller';
import { AuthModule } from '../auth/auth.module';
import { TemporalModule } from '../temporal/temporal.module';

@Module({
  imports: [AuthModule, TemporalModule],
  controllers: [MessageController],
})
export class MessageModule {}
