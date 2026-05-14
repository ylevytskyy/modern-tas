import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  await app.listen(process.env.PORT ?? 3000);
  console.log(`API listening on port ${process.env.PORT ?? 3000}`);
}

bootstrap();
