import { Module } from '@nestjs/common';
import { CallsController } from './calls.controller';
import { AuthModule } from '../auth/auth.module';
import { AriModule } from '../ari/ari.module';

@Module({
  imports: [AuthModule, AriModule],
  controllers: [CallsController],
})
export class CallsModule {}
