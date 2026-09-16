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

  it('limits public application tracking lookups', () => {
    const request = makeRequest('/api/v1/applications/track/ABC123');
    const response = makeResponse();
    const next = jest.fn();

    for (let i = 0; i < 10; i += 1) {
      rateLimitMiddleware(request, response, next);
    }
    rateLimitMiddleware(request, response, next);

    expect(next).toHaveBeenCalledTimes(10);
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
  });

  it('shares the tracking quota across different tracking codes', () => {
    const firstRequest = makeRequest('/api/v1/applications/track/ABC123');
    const secondRequest = makeRequest('/api/v1/applications/track/XYZ789');
    const firstResponse = makeResponse();
    const secondResponse = makeResponse();
    const next = jest.fn();

    for (let i = 0; i < 10; i += 1) {
      rateLimitMiddleware(firstRequest, firstResponse, next);
    }
    rateLimitMiddleware(secondRequest, secondResponse, next);

    expect(next).toHaveBeenCalledTimes(10);
    expect(secondResponse.status).toHaveBeenCalledWith(429);
  });
});
