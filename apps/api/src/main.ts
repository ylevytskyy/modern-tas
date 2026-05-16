import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common';
import { AppModule } from './app.module';
import { WsGateway } from './ws/ws.gateway';
import { WebSocketServer } from 'ws';
import type { IncomingMessage } from 'http';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1', {
    exclude: [{ path: 'internal/(.*)', method: RequestMethod.ALL }],
  });

  const httpServer = await app.listen(process.env.PORT ?? 3000);
  const wss = new WebSocketServer({ noServer: true });
  const wsGateway = app.get(WsGateway);

  httpServer.on('upgrade', (request: IncomingMessage, socket: any, head: Buffer) => {
    const url = new URL(request.url ?? '', `http://${request.headers.host}`);
    if (url.pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        const token = url.searchParams.get('token') ?? '';
        wsGateway.handleConnection(ws, token);
      });
    } else {
      socket.destroy();
    }
  });

  console.log(`API listening on port ${process.env.PORT ?? 3000} (WS on /ws)`);
}

bootstrap();
