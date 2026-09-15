export type GradeBand = {
  code: string;
  lowerInclusive: number;
  upperExclusive: number | null;
  pass: boolean;
  descriptor: string;
  points?: number | null;
  order: number;
};

export type GradeResolution = GradeBand;

export class GradingPolicyError extends Error {}

const EPSILON = 1e-9;

export function validateGradeBands(bands: readonly GradeBand[]): void {
  if (bands.length === 0) throw new GradingPolicyError('A grading policy requires at least one grade band.');

  const ordered = [...bands].sort((a, b) => a.lowerInclusive - b.lowerInclusive || a.order - b.order);

  if (Math.abs(ordered[0].lowerInclusive - 0) > EPSILON) {
    throw new GradingPolicyError('The first grade band must start at 0 percent.');
  }

  for (let index = 0; index < ordered.length; index += 1) {
    const band = ordered[index];
    if (band.lowerInclusive < 0 || band.lowerInclusive > 100) {
      throw new GradingPolicyError(`Grade band ${band.code} has an invalid lower bound.`);
    }
    if (band.upperExclusive !== null && (band.upperExclusive <= band.lowerInclusive || band.upperExclusive > 100)) {
      throw new GradingPolicyError(`Grade band ${band.code} has an invalid upper bound.`);
    }
    if (band.points !== undefined && band.points !== null && band.points < 0) {
      throw new GradingPolicyError(`Grade band ${band.code} has an invalid points value.`);
    }

    const next = ordered[index + 1];
    if (!next) continue;

    if (band.upperExclusive === null) {
      throw new GradingPolicyError(`Only the final grade band may have no upper bound (${band.code}).`);
    }
    if (Math.abs(band.upperExclusive - next.lowerInclusive) > EPSILON) {
      throw new GradingPolicyError(`Grading policy has a gap or overlap between ${band.code} and ${next.code}.`);
    }
  }

  const last = ordered[ordered.length - 1];
  if (last.upperExclusive !== null) {
    if (Math.abs(last.upperExclusive - 100) > EPSILON) {
      throw new GradingPolicyError('The final grade band must end at 100 percent.');
    }
  }
}

export function resolveGrade(percentage: number, bands: readonly GradeBand[]): GradeResolution {
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new GradingPolicyError('Percentage must be between 0 and 100.');
  }

  validateGradeBands(bands);

  const ordered = [...bands].sort((a, b) => a.lowerInclusive - b.lowerInclusive || a.order - b.order);
  const matching = ordered.find((band, index) => {
    const lowerMatch = percentage + EPSILON >= band.lowerInclusive;
    const upperMatch = band.upperExclusive === null
      ? true
      : percentage + EPSILON < band.upperExclusive;
    const isLast = index === ordered.length - 1;
    return lowerMatch && (upperMatch || (isLast && Math.abs(percentage - 100) <= EPSILON));
  });

  if (!matching) {
    throw new GradingPolicyError(`No grade band matches ${percentage} percent.`);
  }

  return { ...matching };
}
