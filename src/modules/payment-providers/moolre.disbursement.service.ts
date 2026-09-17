import { BadRequestException, Injectable } from '@nestjs/common';
import { MoolreConfig, SUPPORTED_CURRENCY, TRANSFER_CHANNEL_MAP, loadMoolreConfig } from './moolre.config';
import { HttpPost } from './moolre.adapter';

/**
 * Moolre disbursement service (out-bound GHS — payroll, refunds, wallet payouts).
 *
 * Ported from the verified Azaman production adapter
 * (AZM-backend/services/moolreDisbursementService.js), whose endpoint paths,
 * body field names, channel codes (MTN=1 / Telecel=6 / AT=7) and the numeric
 * txstatus enum (0=Pending, 1=Success, 2=Failed) were confirmed against
 * docs.moolre.com/ai/initiate-transfer.md and transfer-status.md.
 *
 * This is a PURE I/O adapter — it never touches Prisma and never mutates
 * money records; multi-step money movement stays owned by the payroll and
 * finance services, exactly like Azaman.
 */

export type DisbursementStatus = 'PENDING' | 'SUCCESSFUL' | 'FAILED';

export type InitiateTransferInput = {
  /** Strict idempotency key — sent to Moolre as externalref. */
  referenceId: string;
  amountGhs: number | string;
  recipientPhone: string;
  network?: string;
  /** Free-text narration shown to the recipient (max 160 chars). */
  narration?: string;
};

export type InitiateTransferResult = {
  providerReference: string;
  status: DisbursementStatus;
  mock: boolean;
};

export type TransferStatusResult = {
  providerReference: string;
  status: DisbursementStatus;
  mock: boolean;
};

export type MoolreDisbursementOptions = {
  config?: Partial<MoolreConfig>;
  httpPost?: HttpPost;
};

const TRANSFER_ENDPOINT = '/open/transact/transfer';
const STATUS_ENDPOINT = '/open/transact/status';

/** Confirmed: numeric txstatus — 0 = Pending, 1 = Success, 2 = Failed. */
const TX_STATUS_MAP: Record<string, DisbursementStatus> = {
  '0': 'PENDING',
  '1': 'SUCCESSFUL',
  '2': 'FAILED',
};

@Injectable()
export class MoolreDisbursementService {
  private readonly config: MoolreConfig;
  private readonly httpPost: HttpPost;
  private readonly mockLedger = new Map<string, { status: DisbursementStatus; providerReference: string }>();

  constructor(options: MoolreDisbursementOptions = {}) {
    this.config = { ...loadMoolreConfig(), ...options.config };
    this.httpPost = options.httpPost ?? defaultHttpPost;
  }

  async initiateTransfer(input: InitiateTransferInput): Promise<InitiateTransferResult> {
    if (!input.referenceId || typeof input.referenceId !== 'string') {
      throw new BadRequestException('referenceId is required for Moolre disbursement idempotency.');
    }
    if (!input.amountGhs || Number(input.amountGhs) <= 0) {
      throw new BadRequestException('amountGhs must be positive.');
    }
    if (!input.recipientPhone) {
      throw new BadRequestException('recipientPhone is required.');
    }

    const network = (input.network ?? 'MTN').toUpperCase();
    const channel = TRANSFER_CHANNEL_MAP[network] ?? TRANSFER_CHANNEL_MAP.MTN;
    const narration = (input.narration ?? 'BCI disbursement').slice(0, 160);

    if (this.config.providerMode === 'MOCK') {
      const existing = this.mockLedger.get(input.referenceId);
      if (existing) {
        return { providerReference: existing.providerReference, status: existing.status, mock: true };
      }

      const providerReference = `mock-moolre-tx-${Date.now()}`;
      this.mockLedger.set(input.referenceId, { status: 'PENDING', providerReference });
      return { providerReference, status: 'PENDING', mock: true };
    }

    const body = {
      type: 1,
      currency: SUPPORTED_CURRENCY,
      amount: String(Number(input.amountGhs)),
      receiver: stripMsisdnPrefix(input.recipientPhone),
      externalref: input.referenceId,
      channel,
      reference: narration,
      ...(this.config.accountNumber ? { accountnumber: this.config.accountNumber } : {}),
    };

    const envelope = await this.post(TRANSFER_ENDPOINT, body);
    if (Number(envelope.status) === 0) {
      throw new BadRequestException(envelope.message ?? 'Moolre transfer initiation failed.');
    }
    const providerReference = typeof envelope.data === 'string' && envelope.data.length > 0
      ? envelope.data
      : input.referenceId;
    return { providerReference, status: 'PENDING', mock: false };
  }

  async getTransferStatus(referenceId: string): Promise<TransferStatusResult> {
    if (!referenceId) {
      throw new BadRequestException('referenceId is required.');
    }

    if (this.config.providerMode === 'MOCK') {
      const entry = this.mockLedger.get(referenceId);
      if (!entry) throw new BadRequestException('Unknown reference in the mock disbursement ledger.');
      return { providerReference: entry.providerReference, status: entry.status, mock: true };
    }

    const body = {
      type: 1,
      idtype: 1,
      id: referenceId,
      ...(this.config.accountNumber ? { accountnumber: this.config.accountNumber } : {}),
    };

    const envelope = await this.post(STATUS_ENDPOINT, body);
    if (Number(envelope.status) === 0) {
      throw new BadRequestException(envelope.message ?? 'Moolre status lookup failed.');
    }
    const data = (envelope.data ?? {}) as { txstatus?: number | string };
    const raw = String(data.txstatus ?? '0');
    const status = TX_STATUS_MAP[raw] ?? 'PENDING';
    return { providerReference: referenceId, status, mock: false };
  }

  private async post(path: string, body: unknown) {
    const result = await this.httpPost(`${this.config.baseUrl}${path}`, body, {
      'Content-Type': 'application/json',
      'X-API-USER': this.config.apiUser ?? 'mock-moolre-user',
      'X-API-KEY': this.config.apiKey ?? 'mock-moolre-key',
    });
    if (result && typeof result.body === 'object' && result.body !== null) {
      return result.body as { status?: number | string; code?: string; message?: string; data?: unknown };
    }
    throw new Error(`Moolre request to ${path} returned a non-envelope response.`);
  }
}

/**
 * Disbursements expect a bare MSISDN (0XXXXXXXXX → 233XXXXXXXXX when the local
 * form is given, or the raw digits as-is). Distinct from the collection adapter.
 */
function stripMsisdnPrefix(phone: string): string {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) return `233${digits.slice(1)}`;
  return digits;
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
