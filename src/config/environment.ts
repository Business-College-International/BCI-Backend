import { Logger } from '@nestjs/common';

const REQUIRED = ['DATABASE_URL', 'JWT_ACCESS_SECRET'] as const;

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

  Logger.log(`Environment validated (${nodeEnv}).`, 'Startup');
}
