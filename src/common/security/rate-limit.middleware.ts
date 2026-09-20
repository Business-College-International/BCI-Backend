import type { NextFunction, Request, Response } from 'express';
import { PrismaService } from '../../prisma.service';

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  resetAt: Date;
}

export interface RateLimitStore {
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

const WINDOW_MS = 60_000;
const GENERAL_LIMIT = 120;
const AUTH_LIMIT = 15;
const PUBLIC_APPLICATION_LIMIT = 10;
const WEBHOOK_LIMIT = 300;

export class PrismaRateLimitStore implements RateLimitStore {
  constructor(private readonly prisma: PrismaService) {}

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const nextResetAt = new Date(Date.now() + windowMs);
    const rows = await this.prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>`
      INSERT INTO "RateLimitBucket" ("key", "count", "resetAt", "updatedAt")
      VALUES (${key}, 1, ${nextResetAt}, CURRENT_TIMESTAMP)
      ON CONFLICT ("key") DO UPDATE
      SET
        "count" = CASE
          WHEN "RateLimitBucket"."resetAt" <= CURRENT_TIMESTAMP THEN 1
          ELSE "RateLimitBucket"."count" + 1
        END,
        "resetAt" = CASE
          WHEN "RateLimitBucket"."resetAt" <= CURRENT_TIMESTAMP THEN ${nextResetAt}
          ELSE "RateLimitBucket"."resetAt"
        END,
        "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "count", "resetAt"
    `;
    const row = rows[0];
    if (!row) throw new Error('Rate-limit bucket update returned no row.');
    return {
      allowed: row.count <= limit,
      count: row.count,
      limit,
      resetAt: row.resetAt,
    };
  }
}

function clientKey(request: Request): string {
  return request.ip?.trim() || request.socket.remoteAddress || 'unknown';
}

function limitForPath(path: string): number {
  if (path.includes('/auth/')) return AUTH_LIMIT;
  if (path === '/api/v1/applications') return PUBLIC_APPLICATION_LIMIT;
  if (path.startsWith('/api/v1/payment-providers/webhooks/')) return WEBHOOK_LIMIT;
  return GENERAL_LIMIT;
}

export function createRateLimitMiddleware(store: RateLimitStore) {
  return async function rateLimitMiddleware(request: Request, response: Response, next: NextFunction): Promise<void> {
    const key = `${clientKey(request)}:${request.path}`;
    const limit = limitForPath(request.path);
    try {
      const result = await store.consume(key, limit, WINDOW_MS);
      if (!result.allowed) {
        const retryAfter = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
        response.setHeader('Retry-After', retryAfter.toString());
        response.status(429).json({
          statusCode: 429,
          message: 'Too many requests. Please try again later.',
        });
        return;
      }
      next();
    } catch (error) {
      response.status(503).json({
        statusCode: 503,
        message: 'Rate limiting is temporarily unavailable. Please try again shortly.',
      });
    }
  };
}
