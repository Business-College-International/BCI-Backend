import { GradeBand, GradingPolicyError, resolveGrade, validateGradeBands } from './grading-engine';

const POLICY: GradeBand[] = [
  { code: 'F', lowerInclusive: 0, upperExclusive: 50, pass: false, descriptor: 'Fail', points: 0, order: 1 },
  { code: 'C', lowerInclusive: 50, upperExclusive: 60, pass: true, descriptor: 'Credit', points: 2, order: 2 },
  { code: 'B', lowerInclusive: 60, upperExclusive: 70, pass: true, descriptor: 'Good', points: 3, order: 3 },
  { code: 'A', lowerInclusive: 70, upperExclusive: null, pass: true, descriptor: 'Excellent', points: 4, order: 4 },
];

describe('grading engine', () => {
  it('resolves lower and upper boundaries deterministically', () => {
    expect(resolveGrade(0, POLICY).code).toBe('F');
    expect(resolveGrade(49.99, POLICY).code).toBe('F');
    expect(resolveGrade(50, POLICY).code).toBe('C');
    expect(resolveGrade(59.99, POLICY).code).toBe('C');
    expect(resolveGrade(70, POLICY).code).toBe('A');
    expect(resolveGrade(100, POLICY).code).toBe('A');
  });

  it('keeps values just below a cutoff in the lower band', () => {
    expect(resolveGrade(49.9999999995, POLICY).code).toBe('F');
  });

  it('rejects gaps between bands', () => {
    expect(() => validateGradeBands([
      POLICY[0],
      { ...POLICY[1], lowerInclusive: 51 },
      POLICY[2],
      POLICY[3],
    ])).toThrow(GradingPolicyError);
  });

  it('rejects overlaps between bands', () => {
    expect(() => validateGradeBands([
      POLICY[0],
      { ...POLICY[1], lowerInclusive: 49 },
      POLICY[2],
      POLICY[3],
    ])).toThrow(GradingPolicyError);
  });

  it('requires coverage from 0 through 100', () => {
    expect(() => validateGradeBands([
      { ...POLICY[0], lowerInclusive: 1 },
      POLICY[1],
      POLICY[2],
      POLICY[3],
    ])).toThrow(GradingPolicyError);

    expect(() => validateGradeBands([
      POLICY[0],
      POLICY[1],
      POLICY[2],
      { ...POLICY[3], upperExclusive: 99 },
    ])).toThrow(GradingPolicyError);
  });

  it('rejects invalid percentages', () => {
    expect(() => resolveGrade(-0.01, POLICY)).toThrow(GradingPolicyError);
    expect(() => resolveGrade(100.01, POLICY)).toThrow(GradingPolicyError);
    expect(() => resolveGrade(Number.NaN, POLICY)).toThrow(GradingPolicyError);
  });
});
