import { Module } from '@nestjs/common';
import { ContactController } from './contact.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ContactController],
})
export class ContactModule {}
