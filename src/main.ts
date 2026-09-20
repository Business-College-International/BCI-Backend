import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AppModule } from './app.module';
import { getCorsOrigins, validateEnvironment } from './config/environment';
import { requestLoggingMiddleware } from './common/logging/request-logging.middleware';
import { requestContextMiddleware } from './common/request-context/request-context.middleware';
import { createRateLimitMiddleware, PrismaRateLimitStore } from './common/security/rate-limit.middleware';
import { PrismaService } from './prisma.service';

async function bootstrap(): Promise<void> {
  validateEnvironment();

  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: getCorsOrigins(), credentials: true });
  app.use(requestContextMiddleware);
  const rateLimiter = createRateLimitMiddleware(new PrismaRateLimitStore(app.get(PrismaService)));
  app.use((request: Request, response: Response, next: NextFunction) => {
    void rateLimiter(request, response, next);
  });
  app.use(requestLoggingMiddleware);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}

void bootstrap();