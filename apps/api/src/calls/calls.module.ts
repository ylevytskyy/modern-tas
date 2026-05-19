import { Module } from '@nestjs/common';
import { CallsController } from './calls.controller';
import { AuthModule } from '../auth/auth.module';
import { AriModule } from '../ari/ari.module';
import { ArbiterModule } from '../arbiter/arbiter.module';

@Module({
  imports: [AuthModule, AriModule, ArbiterModule],
  controllers: [CallsController],
})
export class CallsModule {}
