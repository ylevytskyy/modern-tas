import { Module } from '@nestjs/common';
import { MessageController } from './message.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [MessageController],
})
export class MessageModule {}
