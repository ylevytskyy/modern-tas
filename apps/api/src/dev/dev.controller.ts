import {
  Controller, Get, Inject, NotFoundException, Query,
} from '@nestjs/common';
import * as jsonwebtoken from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { DB_TOKEN } from '../database/database.module';
import { user } from '@tas/db';
import type { Db } from '@tas/db/client';

@Controller('dev')
export class DevController {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  @Get('operator-token')
  async operatorToken(@Query('operatorId') operatorId: string): Promise<{ token: string }> {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException();
    }
    const [row] = await this.db.select().from(user).where(eq(user.id, operatorId));
    if (!row) throw new NotFoundException();
    const secret = process.env.APP_JWT_SECRET ?? 'poc-only-not-prod';
    const token = jsonwebtoken.sign(
      { sub: row.id, tenantId: row.tenantId, role: row.role },
      secret,
      { algorithm: 'HS256' },
    );
    return { token };
  }
}
