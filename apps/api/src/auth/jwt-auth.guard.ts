import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as jsonwebtoken from 'jsonwebtoken';
import type { RequestUser } from './request-user.interface';

/**
 * Verifies the HS256 Bearer JWT using the APP_JWT_SECRET env-var (or the
 * hard-coded PoC fallback).  We call jsonwebtoken directly instead of
 * NestJS JwtService so that the guard works when the dev server is run
 * via tsx, which uses esbuild and therefore does NOT emit
 * emitDecoratorMetadata — making NestJS constructor-injection unreliable.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string>; user: RequestUser }>();
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer token');
    }
    const token = authHeader.slice(7);
    const secret = process.env.APP_JWT_SECRET ?? 'poc-only-not-prod';
    try {
      req.user = jsonwebtoken.verify(token, secret) as RequestUser;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return true;
  }
}
