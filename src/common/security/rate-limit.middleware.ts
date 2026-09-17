import type { NextFunction, Request, Response } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 60_000;
const GENERAL_LIMIT = 120;
const AUTH_LIMIT = 15;
const PUBLIC_APPLICATION_LIMIT = 10;
const WEBHOOK_LIMIT = 300;

function clientKey(request: Request): string {
  const forwarded = request.headers['x-forwarded-for'];
  const source = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return (source?.trim() || request.ip || request.socket.remoteAddress || 'unknown');
}

function limitForPath(path: string): number {
  if (path.includes('/auth/')) return AUTH_LIMIT;
  if (path === '/api/v1/applications') return PUBLIC_APPLICATION_LIMIT;
  if (path.startsWith('/api/v1/payment-providers/webhooks/')) return WEBHOOK_LIMIT;
  return GENERAL_LIMIT;
}

export function rateLimitMiddleware(request: Request, response: Response, next: NextFunction): void {
  const key = `${clientKey(request)}:${request.path}`;
  const now = Date.now();
  const limit = limitForPath(request.path);
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    next();
    return;
  }

  if (bucket.count >= limit) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    response.setHeader('Retry-After', retryAfter.toString());
    response.status(429).json({
      statusCode: 429,
      message: 'Too many requests. Please try again later.',
    });
    return;
  }

  bucket.count += 1;
  next();
}

export function resetRateLimitBucketsForTests(): void {
  buckets.clear();
}
