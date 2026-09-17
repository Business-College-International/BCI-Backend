/**
 * Moolre provider configuration.
 *
 * Ported from the verified Azaman production adapter
 * (AZM-backend/services/moolreCollectionService.js + moolreDisbursementService.js),
 * whose endpoints, body field names, channel codes and status enums were
 * confirmed against docs.moolre.com/ai/*.md.
 *
 * Mode gating follows the proven Azaman rule: the adapter stays in MOCK mode
 * unless MOOLRE_PROVIDER === 'LIVE' AND the private credentials are present.
 * MOCK mode never performs network I/O so CI/local runs need no secrets.
 */

export type MoolreEnv = 'sandbox' | 'production';

export interface MoolreConfig {
  /** 'LIVE' enables real network calls; anything else keeps the adapter in MOCK mode. */
  providerMode: 'MOCK' | 'LIVE';
  env: MoolreEnv;
  baseUrl: string;
  apiUser: string | null;
  apiKey: string | null;
  apiPubKey: string | null;
  accountNumber: string | null;
  /** Shared secret used to authenticate Moolre collection webhooks (HMAC-SHA256). */
  webhookSecret: string | null;
}

const PROD_BASE_URL = 'https://api.moolre.com';
const SANDBOX_BASE_URL = 'https://sandbox.moolre.com';

export function loadMoolreConfig(env: NodeJS.ProcessEnv = process.env): MoolreConfig {
  const apiUser = env.MOOLRE_API_USER ?? null;
  const apiKey = env.MOOLRE_API_KEY ?? null;
  const apiPubKey = env.MOOLRE_API_PUBKEY ?? null;
  const accountNumber = env.MOOLRE_ACCOUNT_NUMBER ?? env.MOOLRE_ACCOUNT_ID ?? null;
  const webhookSecret = env.MOOLRE_WEBHOOK_SECRET ?? null;

  const envRaw = env.MOOLRE_ENV ?? 'sandbox';
  const envName: MoolreEnv = envRaw === 'production' || envRaw === 'prod' ? 'production' : 'sandbox';
  const useProd = envName === 'production';
  const baseUrl = env.MOOLRE_BASE_URL ?? (useProd ? PROD_BASE_URL : SANDBOX_BASE_URL);

  const credsPresent = Boolean(apiUser && apiKey);
  const providerMode: MoolreConfig['providerMode'] =
    env.MOOLRE_PROVIDER === 'LIVE' && credsPresent ? 'LIVE' : 'MOCK';

  return {
    providerMode,
    env: useProd ? 'production' : 'sandbox',
    baseUrl,
    apiUser,
    apiKey,
    apiPubKey,
    accountNumber,
    webhookSecret,
  };
}

/**
 * Channel codes for PAYMENT INITIATION (PIN-push collections).
 * ⚠️ Do NOT merge with the transfer/validate map — Moolre uses different
 * codes for initiation (13=MTN) than for transfers/name validation (1=MTN).
 * Source: docs.moolre.com/ai/initiate-payment.md
 */
export const PAYMENT_CHANNEL_MAP: Record<string, number> = {
  MTN: 13,
  TELECEL: 6,
  VODAFONE: 6, // legacy alias for Telecel
  AIRTELTIGO: 7,
};

/**
 * Channel codes for TRANSFERS (disbursements) and name validation.
 * Source: docs.moolre.com/ai/initiate-transfer.md + validate-name.md
 */
export const TRANSFER_CHANNEL_MAP: Record<string, number> = {
  MTN: 1,
  TELECEL: 6,
  VODAFONE: 6,
  AIRTELTIGO: 7,
};

export const SUPPORTED_CURRENCY = 'GHS';
