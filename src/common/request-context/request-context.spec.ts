import { randomUUID } from 'node:crypto';
import { requestContext, getRequestId, injectAuditRequestId } from './request-context';
import { requestContextMiddleware } from './request-context.middleware';

describe('request correlation context', () => {
  it('stores and returns the request id inside the async context', async () => {
    const requestId = randomUUID();

    await requestContext.run({ requestId }, async () => {
      await Promise.resolve();
      expect(getRequestId()).toBe(requestId);
    });

    expect(getRequestId()).toBeUndefined();
  });

  it('injects the active request id into AuditLog create params', async () => {
    const requestId = randomUUID();
    const params = {
      model: 'AuditLog',
      action: 'create',
      args: { data: { entityType: 'Student', entityId: 'student-1' } },
    };

    await requestContext.run({ requestId }, async () => {
      injectAuditRequestId(params);
    });

    expect(params.args.data.requestId).toBe(requestId);
  });

  it('does not overwrite an explicitly supplied audit request id', async () => {
    const requestId = randomUUID();
    const params = {
      model: 'AuditLog',
      action: 'create',
      args: { data: { requestId: 'explicit-id' } },
    };

    await requestContext.run({ requestId }, async () => {
      injectAuditRequestId(params);
    });

    expect(params.args.data.requestId).toBe('explicit-id');
  });

  it('does not inject a request id into non-audit writes', async () => {
    const requestId = randomUUID();
    const params = {
      model: 'Student',
      action: 'create',
      args: { data: {} },
    };

    await requestContext.run({ requestId }, async () => {
      injectAuditRequestId(params);
    });

    expect(params.args.data).toEqual({});
  });

  it('binds one generated id to the response header and async context', async () => {
    const headers = new Map<string, string>();
    const response = {
      setHeader: jest.fn((name: string, value: string) => headers.set(name, value)),
    };
    const next = jest.fn(() => {
      expect(getRequestId()).toBe(headers.get('X-Request-Id'));
    });

    requestContextMiddleware({} as never, response as never, next);

    expect(response.setHeader).toHaveBeenCalledWith('X-Request-Id', expect.any(String));
    expect(headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(next).toHaveBeenCalled();
  });
});
