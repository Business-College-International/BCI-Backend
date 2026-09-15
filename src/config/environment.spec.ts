import { getCorsOrigins, validateEnvironment } from './environment';

describe('environment configuration', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('accepts the required environment in development', () => {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/bci';
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
    process.env.NODE_ENV = 'development';
    process.env.PORT = '3000';

    expect(() => validateEnvironment()).not.toThrow();
    expect(getCorsOrigins()).toEqual(['http://localhost:5173', 'http://localhost:3000']);
  });

  it('accepts explicitly configured CORS origins', () => {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/bci';
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
    process.env.CORS_ORIGINS = 'https://portal.bci.example, https://www.bci.example';

    expect(getCorsOrigins()).toEqual(['https://portal.bci.example', 'https://www.bci.example']);
  });

  it('rejects missing secrets', () => {
    delete process.env.DATABASE_URL;
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);

    expect(() => validateEnvironment()).toThrow('DATABASE_URL');
  });

  it('rejects weak JWT secrets', () => {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/bci';
    process.env.JWT_ACCESS_SECRET = 'too-short';

    expect(() => validateEnvironment()).toThrow('at least 32 characters');
  });

  it('rejects invalid ports', () => {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/bci';
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
    process.env.PORT = '99999';

    expect(() => validateEnvironment()).toThrow('PORT');
  });

  it('requires explicit CORS origins in production', () => {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/bci';
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGINS;

    expect(() => validateEnvironment()).toThrow('CORS_ORIGINS');
  });
});
