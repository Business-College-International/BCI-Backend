import type { Request, Response } from 'express';
import { createRateLimitMiddleware, PrismaRateLimitStore, RateLimitStore } from './rate-limit.middleware';

function makeRequest(path: string, ip = '203.0.113.10'): Request {
  return { path, ip, headers: {}, socket: { remoteAddress: ip } } as Request;
}

function makeResponse() {
  const response = {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  return response;
}

class FakeStore implements RateLimitStore {
  counts = new Map<string, number>();
  async consume(key: string, limit: number, windowMs: number) {
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return { allowed: count <= limit, count, limit, resetAt: new Date(Date.now() + windowMs) };
  }
}

describe('createRateLimitMiddleware', () => {
  it('shares one counter across middleware instances when they use the same store', async () => {
    const store = new FakeStore();
    const first = createRateLimitMiddleware(store);
    const second = createRateLimitMiddleware(store);
    const request = makeRequest('/api/v1/auth/login');
    const response = makeResponse();
    const next = jest.fn();

    for (let i = 0; i < 15; i += 1) await first(request, response, next);
    await second(request, response, next);

    expect(next).toHaveBeenCalledTimes(15);
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
  });

  it('uses the webhook-specific budget', async () => {
    const store = new FakeStore();
    const middleware = createRateLimitMiddleware(store);
    const request = makeRequest('/api/v1/payment-providers/webhooks/moolre');
    const response = makeResponse();
    const next = jest.fn();

    for (let i = 0; i < 121; i += 1) await middleware(request, response, next);

    expect(next).toHaveBeenCalledTimes(121);
    expect(response.status).not.toHaveBeenCalledWith(429);
  });

  it('persists an atomic database bucket result', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ count: 16, resetAt: new Date(Date.now() + 30000) }]);
    const store = new PrismaRateLimitStore({ $queryRaw: queryRaw } as never);

    const result = await store.consume('203.0.113.10:/api/v1/auth/login', 15, 60000);

    expect(result.allowed).toBe(false);
    expect(result.count).toBe(16);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
  it('does not let a caller-supplied X-Forwarded-For change the limiter identity', async () => {
    const store = new FakeStore();
    const middleware = createRateLimitMiddleware(store);
    const request = makeRequest('/api/v1/auth/login', '203.0.113.10');
    request.headers['x-forwarded-for'] = '198.51.100.20';
    const response = makeResponse();
    const next = jest.fn();

    await middleware(request, response, next);

    expect([...store.counts.keys()]).toEqual(['203.0.113.10:/api/v1/auth/login']);
    expect(next).toHaveBeenCalledTimes(1);
  });

});