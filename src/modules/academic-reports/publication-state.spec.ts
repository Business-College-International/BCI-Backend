import {
  assertCorrectionDecisionTransition,
  assertPublicationTransition,
  ReportPublicationStateError,
} from './publication-state';

describe('report publication state machine', () => {
  it('allows the draft publication flow', () => {
    expect(() => assertPublicationTransition('DRAFT', 'READY_FOR_PUBLICATION')).not.toThrow();
    expect(() => assertPublicationTransition('READY_FOR_PUBLICATION', 'PUBLISHED')).not.toThrow();
    expect(() => assertPublicationTransition('PUBLISHED', 'VOIDED')).not.toThrow();
  });

  it('allows returning a ready report to draft before publication', () => {
    expect(() => assertPublicationTransition('READY_FOR_PUBLICATION', 'DRAFT')).not.toThrow();
  });

  it('rejects editing or republishing an already-published report', () => {
    expect(() => assertPublicationTransition('PUBLISHED', 'DRAFT')).toThrow(ReportPublicationStateError);
    expect(() => assertPublicationTransition('PUBLISHED', 'READY_FOR_PUBLICATION')).toThrow(ReportPublicationStateError);
    expect(() => assertPublicationTransition('VOIDED', 'PUBLISHED')).toThrow(ReportPublicationStateError);
  });

  it('allows only pending correction decisions to be approved or rejected', () => {
    expect(() => assertCorrectionDecisionTransition('PENDING', 'APPROVED')).not.toThrow();
    expect(() => assertCorrectionDecisionTransition('PENDING', 'REJECTED')).not.toThrow();
    expect(() => assertCorrectionDecisionTransition('APPROVED', 'REJECTED')).toThrow(ReportPublicationStateError);
    expect(() => assertCorrectionDecisionTransition('REJECTED', 'APPROVED')).toThrow(ReportPublicationStateError);
  });
});
