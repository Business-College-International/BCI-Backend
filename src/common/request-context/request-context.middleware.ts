import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { requestContext } from './request-context';

export function requestContextMiddleware(
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  const requestId = randomUUID();
  response.setHeader('X-Request-Id', requestId);
  requestContext.run({ requestId }, next);
}
