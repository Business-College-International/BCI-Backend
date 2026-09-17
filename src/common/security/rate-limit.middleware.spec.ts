import type { Request, Response } from 'express';
import { rateLimitMiddleware, resetRateLimitBucketsForTests } from './rate-limit.middleware';

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

describe('rateLimitMiddleware', () => {
  beforeEach(() => resetRateLimitBucketsForTests());

  it('allows requests within the general limit', () => {
    const next = jest.fn();
    const request = makeRequest('/api/v1/health');
    const response = makeResponse();

    rateLimitMiddleware(request, response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).not.toHaveBeenCalled();
  });

  it('limits repeated authentication requests', () => {
    const request = makeRequest('/api/v1/auth/login');
    const response = makeResponse();
    const next = jest.fn();

    for (let i = 0; i < 15; i += 1) {
      rateLimitMiddleware(request, response, next);
    }
    rateLimitMiddleware(request, response, next);

    expect(next).toHaveBeenCalledTimes(15);
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
  });

  it('allows provider webhook retries beyond the general API budget', () => {
    const request = makeRequest('/api/v1/payment-providers/webhooks/moolre');
    const response = makeResponse();
    const next = jest.fn();

    for (let i = 0; i < 121; i += 1) {
      rateLimitMiddleware(request, response, next);
    }

    expect(next).toHaveBeenCalledTimes(121);
    expect(response.status).not.toHaveBeenCalledWith(429);
  });
});
