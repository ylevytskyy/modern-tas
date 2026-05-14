import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { AccountModule } from './account/account.module';
import { ContactModule } from './contact/contact.module';
import { FormModule } from './form/form.module';
import { MessageModule } from './message/message.module';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    AccountModule,
    ContactModule,
    FormModule,
    MessageModule,
  ],
})
export class AppModule {}
