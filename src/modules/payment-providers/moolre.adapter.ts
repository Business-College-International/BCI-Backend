import { createHmac, timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import {
  MoolreConfig,
  PAYMENT_CHANNEL_MAP,
  SUPPORTED_CURRENCY,
  loadMoolreConfig,
} from './moolre.config';
import { PaymentProviderPort, ProviderWebhook, VerifiedProviderWebhook } from './payment-provider.port';
import { NormalizedPaymentWebhook } from './payment-webhook.normalization';

const WEBHOOK_SUCCESS_CODE = 'P01';

export type HttpPost = (url: string, body: unknown, headers: Record<string, string>) => Promise<{
  status: number;
  body: unknown;
}>;

export type MoolreAdapterOptions = {
  config?: Partial<MoolreConfig>;
  httpPost?: HttpPost;
  now?: () => Date;
};

export type MoolrePaymentResult = {
  providerReference: string | null;
  requiresOtp: boolean;
  mock: boolean;
  sessionId?: string | null;
};

@Injectable()
export class MoolreAdapter implements PaymentProviderPort {
  readonly provider = 'MOOLRE';

  private readonly config: MoolreConfig;
  private readonly httpPost: HttpPost;
  private readonly now: () => Date;
  private readonly mockLedger = new Map<string, string>();

  constructor(options: MoolreAdapterOptions = {}) {
    this.config = { ...loadMoolreConfig(), ...options.config };
    this.httpPost = options.httpPost ?? defaultHttpPost;
    this.now = options.now ?? (() => new Date());
  }

  async verifyWebhook(input: ProviderWebhook): Promise<VerifiedProviderWebhook> {
    const secret = this.config.webhookSecret;
    if (!secret) {
      throw new ServiceUnavailableException('Moolre webhook secret is not configured; refusing to verify.');
    }
    if (!input.signature) {
      throw new UnauthorizedException('Moolre webhook is missing its signature header.');
    }

    const raw = input.rawBody ?? serializePayload(input.rawPayload);
    let authed = safeEqualHex(
      input.signature,
      createHmac('sha256', secret).update(raw).digest('hex'),
    );

    if (!authed) {
      authed = safeEqualUtf8(input.signature, secret);
    }

    if (!authed) {
      throw new UnauthorizedException('Moolre webhook signature verification failed.');
    }

    return { ...input, signatureVerified: true };
  }

  normalizeWebhook(input: VerifiedProviderWebhook): NormalizedPaymentWebhook {
    const envelope = input.rawPayload as MoolreWebhookEnvelope | null;
    if (!envelope || typeof envelope !== 'object') {
      throw new BadRequestException('Moolre webhook payload is not an envelope object.');
    }

    const data = (envelope.data ?? {}) as MoolreWebhookData;
    const clientReference = typeof data.externalref === 'string' && data.externalref.length > 0
      ? data.externalref
      : null;
    const providerReference = typeof data.id === 'string' && data.id.length > 0 ? data.id : input.eventId;
    const amount = normalizeAmount(data.amount);
    const settled = Number(envelope.status) === 1 && envelope.code === WEBHOOK_SUCCESS_CODE;

    if (settled) {
      return {
        provider: this.provider,
        providerReference,
        clientReference,
        paymentStatus: PaymentStatus.SUCCEEDED,
        amount,
        currency: SUPPORTED_CURRENCY,
        completedAt: this.now(),
        failureCode: null,
        failureMessage: null,
      };
    }

    const failed = Number(envelope.status) === 0;
    return {
      provider: this.provider,
      providerReference,
      clientReference,
      paymentStatus: failed ? PaymentStatus.FAILED : PaymentStatus.PROCESSING,
      amount,
      currency: SUPPORTED_CURRENCY,
      completedAt: failed ? this.now() : null,
      failureCode: failed ? (envelope.code ?? 'MOOLRE_UNSPECIFIED_FAILURE') : null,
      failureMessage: failed ? (envelope.message ?? 'Moolre reported a failed collection.') : null,
    };
  }

  async initiatePayment(input: {
    clientReference: string;
    amount: string;
    currency: string;
    purpose: string;
    callbackUrl: string;
    customer: { name: string; phone: string; network?: string };
  }): Promise<MoolrePaymentResult> {
    if (!input.clientReference) throw new BadRequestException('clientReference is required for Moolre initiation.');
    if (input.currency !== SUPPORTED_CURRENCY) throw new BadRequestException(`Moolre collections only support ${SUPPORTED_CURRENCY}.`);

    if (this.config.providerMode === 'MOCK') {
      const providerReference = `mock-moolre-${this.now().getTime()}`;
      this.mockLedger.set(input.clientReference, providerReference);
      return { providerReference, requiresOtp: false, mock: true, sessionId: null };
    }

    const network = (input.customer.network ?? 'MTN').toUpperCase();
    const channel = PAYMENT_CHANNEL_MAP[network] ?? PAYMENT_CHANNEL_MAP.MTN;
    const body = {
      type: 1,
      channel,
      currency: SUPPORTED_CURRENCY,
      payer: sanitizeMsisdn(input.customer.phone),
      amount: input.amount,
      externalref: input.clientReference,
      accountnumber: this.config.accountNumber ?? undefined,
    };

    const envelope = await this.post('/open/transact/payment', body, this.publicHeaders());
    const sessionId = extractSessionId(envelope);
    if (Number(envelope.status) === 0) throw new BadRequestException(envelope.message ?? 'Moolre payment initiation failed.');
    if (envelope.code === 'TP14') {
      return { providerReference: null, requiresOtp: true, mock: false, sessionId };
    }
    return {
      providerReference: extractProviderReference(envelope.data),
      requiresOtp: false,
      mock: false,
      sessionId,
    };
  }

  async submitPaymentOtp(input: {
    clientReference: string;
    amount: string;
    currency: string;
    payer: string;
    network?: string;
    otpCode: string;
    sessionId?: string | null;
  }): Promise<MoolrePaymentResult> {
    if (!input.clientReference) throw new BadRequestException('clientReference is required for Moolre OTP submission.');
    if (!input.otpCode) throw new BadRequestException('otpCode is required for Moolre OTP submission.');
    if (input.currency !== SUPPORTED_CURRENCY) throw new BadRequestException(`Moolre collections only support ${SUPPORTED_CURRENCY}.`);

    if (this.config.providerMode === 'MOCK') {
      const providerReference = this.mockLedger.get(input.clientReference) ?? `mock-moolre-${this.now().getTime()}`;
      this.mockLedger.set(input.clientReference, providerReference);
      return { providerReference, requiresOtp: false, mock: true, sessionId: input.sessionId ?? null };
    }

    const network = (input.network ?? 'MTN').toUpperCase();
    const channel = PAYMENT_CHANNEL_MAP[network] ?? PAYMENT_CHANNEL_MAP.MTN;
    const body = {
      type: 1,
      channel,
      currency: SUPPORTED_CURRENCY,
      payer: sanitizeMsisdn(input.payer),
      amount: input.amount,
      externalref: input.clientReference,
      otpcode: input.otpCode,
      ...(input.sessionId ? { sessionid: input.sessionId } : {}),
      accountnumber: this.config.accountNumber ?? undefined,
    };

    const envelope = await this.post('/open/transact/payment', body, this.publicHeaders());
    const sessionId = extractSessionId(envelope) ?? input.sessionId ?? null;
    if (Number(envelope.status) === 0) {
      throw new BadRequestException(envelope.message ?? 'Moolre OTP submission failed.');
    }
    if (envelope.code === 'TP14') {
      return { providerReference: null, requiresOtp: true, mock: false, sessionId };
    }

    return {
      providerReference: extractProviderReference(envelope.data),
      requiresOtp: false,
      mock: false,
      sessionId,
    };
  }

  peekMockLedger(clientReference: string): string | null {
    return this.mockLedger.get(clientReference) ?? null;
  }

  private publicHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-API-USER': this.config.apiUser ?? 'mock-moolre-user',
      'X-API-PUBKEY': this.config.apiPubKey ?? 'mock-moolre-pubkey',
    };
  }

  private async post(path: string, body: unknown, headers: Record<string, string>) {
    const result = await this.httpPost(`${this.config.baseUrl}${path}`, body, headers);
    if (result && typeof result.body === 'object' && result.body !== null) return result.body as MoolreResponseEnvelope;
    throw new Error(`Moolre request to ${path} returned a non-envelope response.`);
  }
}

export type MoolreResponseEnvelope = {
  status?: number | string;
  code?: string | null;
  message?: string | null;
  sessionid?: string | null;
  sessionId?: string | null;
  data?: unknown;
};

export type MoolreWebhookEnvelope = MoolreResponseEnvelope & {
  data?: {
    externalref?: string;
    payer?: string;
    amount?: string | number;
    id?: string;
  } | null;
};

type MoolreWebhookData = NonNullable<MoolreWebhookEnvelope['data']>;

export function sanitizeMsisdn(phone: string): string {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('233') && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.startsWith('0') && digits.length === 10) return digits;
  return digits;
}

function normalizeAmount(raw: string | number | undefined | null): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return parsed.toFixed(2);
}

function serializePayload(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  return JSON.stringify(payload);
}

function extractSessionId(envelope: MoolreResponseEnvelope): string | null {
  const direct = envelope.sessionid ?? envelope.sessionId;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  if (envelope.data && typeof envelope.data === 'object') {
    const data = envelope.data as Record<string, unknown>;
    const nested = data.sessionid ?? data.sessionId;
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
  }
  return null;
}

function extractProviderReference(data: unknown): string | null {
  if (typeof data === 'string' && data.trim()) return data.trim();
  if (data && typeof data === 'object') {
    const payload = data as Record<string, unknown>;
    for (const key of ['id', 'providerReference', 'reference', 'transactionid', 'transactionId']) {
      const value = payload[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return null;
}

function safeEqualHex(actual: string, expected: string): boolean {
  const a = actual.trim().toLowerCase().replace(/^sha256=/, '');
  const b = expected.trim().toLowerCase();
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function safeEqualUtf8(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

const defaultHttpPost: HttpPost = async (url, body, headers) => {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed };
};
