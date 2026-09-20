import { Logger } from '@nestjs/common';

const REQUIRED = ['DATABASE_URL', 'JWT_ACCESS_SECRET'] as const;

export function getTrustProxyHops(): number {
  const raw = process.env.TRUST_PROXY_HOPS?.trim();
  if (!raw) return 0;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10) {
    throw new Error('TRUST_PROXY_HOPS must be an integer between 0 and 10.');
  }

  return parsed;
}

export function getCorsOrigins(): string[] {
  const configured = process.env.CORS_ORIGINS?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
  const nodeEnv = process.env.NODE_ENV ?? 'development';

  if (nodeEnv === 'production' && configured.length === 0) {
    throw new Error('CORS_ORIGINS must contain at least one origin in production.');
  }

  if (configured.length > 0) return configured;
  return ['http://localhost:5173', 'http://localhost:3000'];
}

export function validateEnvironment(): void {
  const missing = REQUIRED.filter((key) => !process.env[key]?.trim());

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if ((process.env.JWT_ACCESS_SECRET ?? '').length < 32) {
    throw new Error('JWT_ACCESS_SECRET must be at least 32 characters long.');
  }

  const port = process.env.PORT;
  if (port !== undefined) {
    const parsed = Number(port);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      throw new Error('PORT must be an integer between 1 and 65535.');
    }
  }

  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error(`Unsupported NODE_ENV: ${nodeEnv}`);
  }

  getCorsOrigins();
  getTrustProxyHops();
  Logger.log(`Environment validated (${nodeEnv}).`, 'Startup');
}
