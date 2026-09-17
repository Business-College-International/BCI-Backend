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

/**
 * Moolre collection adapter (in-bound GHS Mobile Money via PIN-push).
 *
 * Implements the BCI PaymentProviderPort against the Moolre Open API using the
 * request/response contract verified in Azaman production
 * (AZM-backend/services/moolreCollectionService.js + the collection webhook in
 * AZM-backend/controllers/depositController.js). Webhook authentication is
 * signature-first: HMAC-SHA256 over the raw payload, with a constant-time
 * plaintext secret fallback — both compared with crypto.timingSafeEqual.
 *
 * MOCK/LIVE gating: when the effective mode is MOCK (default — MOOLRE_PROVIDER
 * is not 'LIVE' or credentials are missing) the adapter performs no network
 * I/O: initiations return a deterministic mock provider reference and webhook
 * verification still requires the shared secret, so local flows exercise the
 * real code paths without touching Moolre.
 */

/** Moolre webhook settlement code: confirmed successful collection. */
const WEBHOOK_SUCCESS_CODE = 'P01';

/** HTTP transport injected for testing; defaults to global fetch (Node 20). */
export type HttpPost = (url: string, body: unknown, headers: Record<string, string>) => Promise<{
  status: number;
  body: unknown;
}>;

export type MoolreAdapterOptions = {
  config?: Partial<MoolreConfig>;
  httpPost?: HttpPost;
  now?: () => Date;
};

@Injectable()
export class MoolreAdapter implements PaymentProviderPort {
  readonly provider = 'MOOLRE';

  private readonly config: MoolreConfig;
  private readonly httpPost: HttpPost;
  private readonly now: () => Date;
  /** MOCK-mode correlation ledger: clientReference → provider reference. */
  private readonly mockLedger = new Map<string, string>();

  constructor(options: MoolreAdapterOptions = {}) {
    this.config = { ...loadMoolreConfig(), ...options.config };
    this.httpPost = options.httpPost ?? defaultHttpPost;
    this.now = options.now ?? (() => new Date());
  }

  // ── Webhook authentication ─────────────────────────────────────────────────

  async verifyWebhook(input: ProviderWebhook): Promise<VerifiedProviderWebhook> {
    if (this.config.providerMode !== 'LIVE') {
      // Verification is the security boundary — it stays enabled in every mode.
    }
    const secret = this.config.webhookSecret;
    if (!secret) {
      // Fail closed: refusing to verify is safer than crediting funds without
      // an authentic signature. Mirrors the proven Azaman 503 behaviour.
      throw new ServiceUnavailableException('Moolre webhook secret is not configured; refusing to verify.');
    }
    if (!input.signature) {
      throw new UnauthorizedException('Moolre webhook is missing its signature header.');
    }

    const raw = serializePayload(input.rawPayload);
    let authed = false;

    // 1) HMAC-SHA256 over the raw payload (preferred).
    const expectedHmac = createHmac('sha256', secret).update(raw).digest('hex');
    authed = safeEqualHex(input.signature, expectedHmac);

    // 2) Constant-time plaintext secret fallback.
    if (!authed) {
      authed = safeEqualUtf8(input.signature, secret);
    }

    if (!authed) {
      throw new UnauthorizedException('Moolre webhook signature verification failed.');
    }

    return { ...input, signatureVerified: true };
  }

  // ── Webhook normalization ──────────────────────────────────────────────────

  normalizeWebhook(input: VerifiedProviderWebhook): NormalizedPaymentWebhook {
    const envelope = input.rawPayload as MoolreWebhookEnvelope | null;
    if (!envelope || typeof envelope !== 'object') {
      throw new BadRequestException('Moolre webhook payload is not an envelope object.');
    }

    const data = (envelope.data ?? {}) as MoolreWebhookData;
    // Our correlation token: the externalref we minted at initiation and sent
    // to Moolre. Confirmed field name from the Azaman webhook handler.
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

    // Business failure: Moolre signals failures inside the envelope with a
    // numeric status of 0. Anything else is an informational/intermediate
    // event — mapped to PROCESSING so it can never be mistaken for settlement.
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

  // ── Payment initiation (PIN-push collections) ───────────────────────────────

  async initiatePayment(input: {
    clientReference: string;
    amount: string;
    currency: string;
    purpose: string;
    callbackUrl: string;
    customer: { name: string; phone: string; network?: string };
  }): Promise<{ providerReference: string | null; requiresOtp: boolean; mock: boolean }> {
    if (!input.clientReference) {
      throw new BadRequestException('clientReference is required for Moolre initiation.');
    }
    if (input.currency !== SUPPORTED_CURRENCY) {
      throw new BadRequestException(`Moolre collections only support ${SUPPORTED_CURRENCY}.`);
    }

    if (this.config.providerMode === 'MOCK') {
      const providerReference = `mock-moolre-${this.now().getTime()}`;
      this.mockLedger.set(input.clientReference, providerReference);
      return { providerReference, requiresOtp: false, mock: true };
    }

    // Channel codes differ per operation — this is the initiation map
    // (MTN=13), NOT the transfer map (MTN=1). See moolre.config.ts.
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

    if (Number(envelope.status) === 0) {
      throw new BadRequestException(envelope.message ?? 'Moolre payment initiation failed.');
    }
    if (envelope.code === 'TP14') {
      // OTP-gated flow: Moolre needs an OTP retry to proceed.
      return { providerReference: null, requiresOtp: true, mock: false };
    }
    // TR099: accepted, PIN-push prompt sent to the payer's phone.
    return { providerReference: typeof envelope.data === 'string' ? envelope.data : null, requiresOtp: false, mock: false };
  }

  /**
   * Resolve the already-initiated MOCK payment status. Used by local flows and
   * tests to drive a webhook-like settlement without live credentials.
   */
  peekMockLedger(clientReference: string): string | null {
    return this.mockLedger.get(clientReference) ?? null;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private publicHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-API-USER': this.config.apiUser ?? 'mock-moolre-user',
      'X-API-PUBKEY': this.config.apiPubKey ?? 'mock-moolre-pubkey',
    };
  }

  /**
   * POST and return Moolre's raw envelope ({ status, code, message, data }).
   * Moolre signals business errors inside the envelope with an integer status
   * of 0 — a non-2xx response that still carries an envelope object is handed
   * back unchanged so the caller's status/code logic runs. Only transport-level
   * failures throw.
   */
  private async post(path: string, body: unknown, headers: Record<string, string>) {
    const result = await this.httpPost(`${this.config.baseUrl}${path}`, body, headers);
    if (result && typeof result.body === 'object' && result.body !== null) {
      return result.body as MoolreResponseEnvelope;
    }
    throw new Error(`Moolre request to ${path} returned a non-envelope response.`);
  }
}

// ── Moolre wire types (field names confirmed against docs.moolre.com/ai) ─────

export type MoolreResponseEnvelope = {
  status?: number | string;
  code?: string | null;
  message?: string | null;
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

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Collections expect a local 0-prefixed MSISDN (233XXXXXXXXX → 0XXXXXXXXX).
 * Distinct from the disbursement adapter, which strips to a bare MSISDN.
 */
export function sanitizeMsisdn(phone: string): string {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('233') && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.startsWith('0') && digits.length === 10) return digits;
  return digits;
}

/** Format any provider amount to a strict 2-decimal string, or null when absent. */
function normalizeAmount(raw: string | number | undefined | null): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return parsed.toFixed(2);
}

/** Deterministic serialization so HMAC signing matches both sides. */
function serializePayload(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  return JSON.stringify(payload);
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

/** Default transport: global fetch with a 15s timeout. */
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
