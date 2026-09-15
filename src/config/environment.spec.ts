import { validateEnvironment } from './environment';

describe('validateEnvironment', () => {
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
});
