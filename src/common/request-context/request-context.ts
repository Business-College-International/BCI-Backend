import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestContext = {
  requestId: string;
};

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

type AuditCreateParams = {
  model?: string;
  action?: string;
  args?: { data?: Record<string, unknown> };
};

export function injectAuditRequestId(params: AuditCreateParams): void {
  if (params.model !== 'AuditLog' || params.action !== 'create' || !params.args?.data) {
    return;
  }

  const requestId = getRequestId();
  if (requestId && !params.args.data.requestId) {
    params.args.data.requestId = requestId;
  }
}
