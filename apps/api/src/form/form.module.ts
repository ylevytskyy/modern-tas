import { Module } from '@nestjs/common';
import { FormController } from './form.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [FormController],
})
export class FormModule {}
