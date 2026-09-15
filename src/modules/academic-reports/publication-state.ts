export type ReportPublicationStatus =
  | 'DRAFT'
  | 'READY_FOR_PUBLICATION'
  | 'PUBLISHED'
  | 'VOIDED';

export type CorrectionDecision = 'PENDING' | 'APPROVED' | 'REJECTED';

export class ReportPublicationStateError extends Error {}

const ALLOWED: Record<ReportPublicationStatus, readonly ReportPublicationStatus[]> = {
  DRAFT: ['READY_FOR_PUBLICATION'],
  READY_FOR_PUBLICATION: ['PUBLISHED', 'DRAFT'],
  PUBLISHED: ['VOIDED'],
  VOIDED: [],
};

export function assertPublicationTransition(
  from: ReportPublicationStatus,
  to: ReportPublicationStatus,
): void {
  if (!ALLOWED[from].includes(to)) {
    throw new ReportPublicationStateError(`Invalid report publication transition: ${from} -> ${to}.`);
  }
}

export function assertCorrectionDecisionTransition(
  from: CorrectionDecision,
  to: CorrectionDecision,
): void {
  if (from === 'PENDING' && (to === 'APPROVED' || to === 'REJECTED')) return;
  if (from === to) return;
  throw new ReportPublicationStateError(`Invalid correction decision transition: ${from} -> ${to}.`);
}
