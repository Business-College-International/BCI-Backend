import { createHmac } from 'crypto';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { MoolreAdapter, sanitizeMsisdn } from './moolre.adapter';
import { loadMoolreConfig } from './moolre.config';

const WEBHOOK_SECRET = 'test-webhook-secret';

function makeAdapter(overrides: Record<string, unknown> = {}, httpPost?: any) {
  return new MoolreAdapter({
    config: { webhookSecret: WEBHOOK_SECRET, ...overrides },
    httpPost,
    now: () => new Date('2026-09-16T12:00:00.000Z'),
  });
}

function signedPayload(payload: unknown, secret = WEBHOOK_SECRET) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return createHmac('sha256', secret).update(raw).digest('hex');
}

const settlementPayload = {
  status: 1,
  code: 'P01',
  message: 'Payment successful',
  data: { externalref: 'bci-client-ref-1', payer: '0244000000', amount: '150' },
};

const failurePayload = {
  status: 0,
  code: 'P02',
  message: 'Payment failed',
  data: { externalref: 'bci-client-ref-1' },
};

describe('MoolreAdapter.verifyWebhook', () => {
  it('accepts a correctly HMAC-signed webhook', async () => {
    const adapter = makeAdapter();
    const verified = await adapter.verifyWebhook({
      provider: 'MOOLRE',
      eventId: 'evt-1',
      eventType: 'payment.succeeded',
      signature: signedPayload(settlementPayload),
      rawPayload: settlementPayload,
    });
    expect(verified.signatureVerified).toBe(true);
  });

  it('verifies HMAC against the exact raw request body', async () => {
    const adapter = makeAdapter();
    const rawBody = '{"status":1,"code":"P01","data":{"externalref":"bci-client-ref-1"}}';
    const verified = await adapter.verifyWebhook({
      provider: 'MOOLRE',
      eventId: 'evt-raw',
      eventType: 'payment.succeeded',
      signature: signedPayload(rawBody),
      rawPayload: JSON.parse(rawBody),
      rawBody,
    });
    expect(verified.signatureVerified).toBe(true);
  });

  it('rejects a signature signed with the wrong secret', async () => {
    const adapter = makeAdapter();
    await expect(adapter.verifyWebhook({
      provider: 'MOOLRE',
      eventId: 'evt-1',
      eventType: 'payment.succeeded',
      signature: signedPayload(settlementPayload, 'wrong-secret'),
      rawPayload: settlementPayload,
    })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a tampered payload', async () => {
    const adapter = makeAdapter();
    const signature = signedPayload(settlementPayload);
    await expect(adapter.verifyWebhook({
      provider: 'MOOLRE',
      eventId: 'evt-1',
      eventType: 'payment.succeeded',
      signature,
      rawPayload: { ...settlementPayload, data: { ...settlementPayload.data, amount: '9999' } },
    })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('falls back to the constant-time plaintext secret header', async () => {
    const adapter = makeAdapter();
    const verified = await adapter.verifyWebhook({
      provider: 'MOOLRE',
      eventId: 'evt-2',
      eventType: 'payment.succeeded',
      signature: WEBHOOK_SECRET,
      rawPayload: settlementPayload,
    });
    expect(verified.signatureVerified).toBe(true);
  });

  it('fails closed when no webhook secret is configured', async () => {
    const adapter = makeAdapter({ webhookSecret: null });
    await expect(adapter.verifyWebhook({
      provider: 'MOOLRE',
      eventId: 'evt-3',
      eventType: 'payment.succeeded',
      signature: 'anything',
      rawPayload: settlementPayload,
    })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('MoolreAdapter.normalizeWebhook', () => {
  it('maps a confirmed P01 settlement to SUCCEEDED with normalized amount', () => {
    const adapter = makeAdapter();
    const normalized = adapter.normalizeWebhook({
      provider: 'MOOLRE',
      eventId: 'evt-1',
      eventType: 'payment.succeeded',
      signature: signedPayload(settlementPayload),
      signatureVerified: true,
      rawPayload: settlementPayload,
    });

    expect(normalized).toEqual({
      provider: 'MOOLRE',
      providerReference: 'evt-1',
      clientReference: 'bci-client-ref-1',
      paymentStatus: PaymentStatus.SUCCEEDED,
      amount: '150.00',
      currency: 'GHS',
      completedAt: new Date('2026-09-16T12:00:00.000Z'),
      failureCode: null,
      failureMessage: null,
    });
  });

  it('maps a business failure to FAILED with the provider code', () => {
    const adapter = makeAdapter();
    const normalized = adapter.normalizeWebhook({
      provider: 'MOOLRE',
      eventId: 'evt-2',
      eventType: 'payment.failed',
      signature: signedPayload(failurePayload),
      signatureVerified: true,
      rawPayload: failurePayload,
    });

    expect(normalized.paymentStatus).toBe(PaymentStatus.FAILED);
    expect(normalized.failureCode).toBe('P02');
    expect(normalized.failureMessage).toBe('Payment failed');
    expect(normalized.clientReference).toBe('bci-client-ref-1');
  });

  it('maps informational events to PROCESSING', () => {
    const adapter = makeAdapter();
    const normalized = adapter.normalizeWebhook({
      provider: 'MOOLRE',
      eventId: 'evt-3',
      eventType: 'payment.pending',
      signature: signedPayload({ status: 2, code: 'P00', data: { externalref: 'bci-client-ref-1' } }),
      signatureVerified: true,
      rawPayload: { status: 2, code: 'P00', data: { externalref: 'bci-client-ref-1' } },
    });

    expect(normalized.paymentStatus).toBe(PaymentStatus.PROCESSING);
    expect(normalized.completedAt).toBeNull();
  });

  it('uses the provider transaction id as providerReference when present', () => {
    const adapter = makeAdapter();
    const payload = { ...settlementPayload, data: { ...settlementPayload.data, id: 'moolre-tx-9' } };
    const normalized = adapter.normalizeWebhook({
      provider: 'MOOLRE',
      eventId: 'evt-4',
      eventType: 'payment.succeeded',
      signature: signedPayload(payload),
      signatureVerified: true,
      rawPayload: payload,
    });
    expect(normalized.providerReference).toBe('moolre-tx-9');
  });
});

describe('MoolreAdapter.initiatePayment', () => {
  it('returns a mock provider reference in MOCK mode without network I/O', async () => {
    const adapter = makeAdapter();
    const httpPost = jest.fn();
    const result = await adapter.initiatePayment({
      clientReference: 'bci-client-ref-1',
      amount: '150.00',
      currency: 'GHS',
      purpose: 'FEE',
      callbackUrl: 'https://bci.example/callback',
      customer: { name: 'Test Guardian', phone: '+233244000000' },
    });
    expect(result.mock).toBe(true);
    expect(result.requiresOtp).toBe(false);
    expect(result.providerReference).toMatch(/^mock-moolre-/);
    expect(httpPost).not.toHaveBeenCalled();
  });

  it('posts to the initiation endpoint with the initiation channel map in LIVE mode', async () => {
    const httpPost = jest.fn(async () => ({ status: 200, body: { status: 1, code: 'TR099', data: 'moolre-ref-1' } }));
    const adapter = makeAdapter({ providerMode: 'LIVE', apiUser: 'u', apiKey: 'k', apiPubKey: 'p', accountNumber: 'ACC-1' }, httpPost);

    const result = await adapter.initiatePayment({
      clientReference: 'bci-client-ref-1',
      amount: '150.00',
      currency: 'GHS',
      purpose: 'FEE',
      callbackUrl: 'https://bci.example/callback',
      customer: { name: 'Test Guardian', phone: '233244000000', network: 'MTN' },
    });

    expect(httpPost).toHaveBeenCalledWith(
      expect.stringContaining('/open/transact/payment'),
      expect.objectContaining({ channel: 13, externalref: 'bci-client-ref-1', payer: '0244000000' }),
      expect.objectContaining({ 'X-API-PUBKEY': 'p' }),
    );
    expect(result).toEqual({ providerReference: 'moolre-ref-1', requiresOtp: false, mock: false, sessionId: null });
  });

  it('surfaces the OTP gate and session id on TP14', async () => {
    const httpPost = jest.fn(async () => ({ status: 200, body: { status: 1, code: 'TP14', data: { sessionid: 'session-1' } } }));
    const adapter = makeAdapter({ providerMode: 'LIVE' }, httpPost);
    const result = await adapter.initiatePayment({
      clientReference: 'ref',
      amount: '10.00',
      currency: 'GHS',
      purpose: 'FEE',
      callbackUrl: 'https://bci.example/callback',
      customer: { name: 'G', phone: '0244000000' },
    });
    expect(result.requiresOtp).toBe(true);
    expect(result.providerReference).toBeNull();
    expect(result.sessionId).toBe('session-1');
  });
});

describe('MoolreAdapter.submitPaymentOtp', () => {
  it('submits otpcode and optional sessionid to the payment endpoint', async () => {
    const httpPost = jest.fn(async () => ({ status: 200, body: { status: 1, code: 'P01', data: 'moolre-ref-otp-1' } }));
    const adapter = makeAdapter({ providerMode: 'LIVE', apiUser: 'u', apiKey: 'k', apiPubKey: 'p', accountNumber: 'ACC-1' }, httpPost);

    const result = await adapter.submitPaymentOtp({
      clientReference: 'bci-client-ref-1',
      amount: '10.00',
      currency: 'GHS',
      payer: '0244000000',
      network: 'Telecel',
      otpCode: '123456',
      sessionId: 'session-1',
    });

    expect(httpPost).toHaveBeenCalledWith(
      expect.stringContaining('/open/transact/payment'),
      expect.objectContaining({
        type: 1,
        channel: 6,
        payer: '0244000000',
        amount: '10.00',
        externalref: 'bci-client-ref-1',
        otpcode: '123456',
        sessionid: 'session-1',
      }),
      expect.objectContaining({ 'X-API-PUBKEY': 'p' }),
    );
    expect(result).toEqual({ providerReference: 'moolre-ref-otp-1', requiresOtp: false, mock: false, sessionId: 'session-1' });
  });

  it('keeps the OTP gate open when Moolre returns TP14 again', async () => {
    const httpPost = jest.fn(async () => ({ status: 200, body: { status: 1, code: 'TP14', sessionid: 'session-2' } }));
    const adapter = makeAdapter({ providerMode: 'LIVE' }, httpPost);

    const result = await adapter.submitPaymentOtp({
      clientReference: 'ref',
      amount: '10.00',
      currency: 'GHS',
      payer: '0244000000',
      otpCode: '111111',
      sessionId: 'session-1',
    });

    expect(result.requiresOtp).toBe(true);
    expect(result.sessionId).toBe('session-2');
  });
});

describe('sanitizeMsisdn', () => {
  it('converts international form to local 0-prefixed form', () => {
    expect(sanitizeMsisdn('+233 24 400 0000')).toBe('0244000000');
    expect(sanitizeMsisdn('0244000000')).toBe('0244000000');
  });
});

describe('moolre config gating', () => {
  it('stays in MOCK mode unless LIVE provider and credentials are set', () => {
    expect(loadMoolreConfig({}).providerMode).toBe('MOCK');
    expect(loadMoolreConfig({ MOOLRE_PROVIDER: 'LIVE' }).providerMode).toBe('MOCK');
    expect(loadMoolreConfig({ MOOLRE_PROVIDER: 'LIVE', MOOLRE_API_USER: 'u', MOOLRE_API_KEY: 'k', MOOLRE_API_PUBKEY: 'p', MOOLRE_ACCOUNT_NUMBER: 'ACC-1', MOOLRE_WEBHOOK_SECRET: WEBHOOK_SECRET }).providerMode).toBe('MOCK');
    expect(loadMoolreConfig({ MOOLRE_PROVIDER: 'LIVE', MOOLRE_LIVE_CONFIRMED: 'true', MOOLRE_API_USER: 'u', MOOLRE_API_KEY: 'k', MOOLRE_API_PUBKEY: 'p', MOOLRE_ACCOUNT_NUMBER: 'ACC-1', MOOLRE_WEBHOOK_SECRET: WEBHOOK_SECRET }).providerMode).toBe('LIVE');
    expect(loadMoolreConfig({
      MOOLRE_PROVIDER: 'LIVE',
      MOOLRE_LIVE_CONFIRMED: 'true',
      MOOLRE_API_USER: 'u',
      MOOLRE_API_KEY: 'k',
      MOOLRE_API_PUBKEY: 'p',
      MOOLRE_ACCOUNT_NUMBER: 'ACC-1',
      MOOLRE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    }).providerMode).toBe('LIVE');
  });
});
