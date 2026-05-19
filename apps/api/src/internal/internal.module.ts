import { Module } from '@nestjs/common';
import { DispatchDeliverController } from './dispatch-deliver.controller';
import { DispatchLatenciesController } from './dispatch-latencies.controller';
import { WsModule } from '../ws/ws.module';
import { ArbiterModule } from '../arbiter/arbiter.module';

@Module({
  imports: [WsModule, ArbiterModule],
  controllers: [DispatchDeliverController, DispatchLatenciesController],
})
export class InternalModule {}
