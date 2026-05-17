import { Module } from '@nestjs/common';
import { DispatchDeliverController } from './dispatch-deliver.controller';
import { WsModule } from '../ws/ws.module';

@Module({
  imports: [WsModule],
  controllers: [DispatchDeliverController],
})
export class InternalModule {}
