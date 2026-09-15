import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');

export function requestLoggingMiddleware(request: Request, response: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  const requestId = response.getHeader('X-Request-Id')?.toString() ?? 'unknown';

  response.on('finish', () => {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    logger.log(
      JSON.stringify({
        requestId,
        method: request.method,
        path: request.originalUrl,
        statusCode: response.statusCode,
        durationMs: Number(elapsedMs.toFixed(2)),
      }),
    );
  });

  next();
}
