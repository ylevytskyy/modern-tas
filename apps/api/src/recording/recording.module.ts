import { Module } from '@nestjs/common';
import { RecordingService } from './recording.service';
import { AriModule } from '../ari/ari.module';
import { Client as MinioClient } from 'minio';

@Module({
  imports: [AriModule],
  providers: [
    RecordingService,
    {
      provide: 'MINIO_CLIENT',
      useFactory: () =>
        new MinioClient({
          endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
          port: Number(process.env.MINIO_PORT ?? 9000),
          useSSL: false,
          accessKey: process.env.MINIO_ACCESS_KEY ?? 'tas',
          secretKey: process.env.MINIO_SECRET_KEY ?? 'tas12345',
        }),
    },
  ],
  exports: [RecordingService],
})
export class RecordingModule {}
