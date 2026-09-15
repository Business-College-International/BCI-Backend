import { buildReportSnapshot, serializeReportSnapshot } from './report-snapshot';

describe('report snapshot builder', () => {
  const input = {
    student: {
      id: 'student-1',
      admissionNumber: 'BCI-001',
      firstName: 'Ama',
      lastName: 'Doe',
      status: 'ACTIVE',
    },
    term: {
      id: 'term-1',
      code: 'TERM1',
      name: 'First Term',
      startsAt: '2026-09-01T00:00:00.000Z',
      endsAt: '2026-12-15T00:00:00.000Z',
    },
    calculation: {
      overallPercentage: 82.5,
      mode: 'UNWEIGHTED_AVERAGE',
      weightedAssessmentCount: 0,
      unweightedAssessmentCount: 4,
      totalConfiguredWeight: null,
    },
    subjects: [
      { code: 'ENG', name: 'English', assessmentCount: 2, averagePercentage: 82.5 },
    ],
    assessments: [],
    grading: { assigned: false, reason: 'No policy configured.' },
  };

  it('adds an explicit snapshot schema version', () => {
    const snapshot = buildReportSnapshot(input);
    expect(snapshot.schemaVersion).toBe(1);
  });

  it('creates an independent serialized snapshot', () => {
    const snapshot = buildReportSnapshot(input);
    const serialized = serializeReportSnapshot(snapshot);
    const parsed = JSON.parse(serialized);

    expect(parsed).toEqual(snapshot);
    expect(parsed).not.toBe(snapshot);
  });

  it('does not expose a mutable persistence operation', () => {
    const snapshot = buildReportSnapshot(input);
    const original = JSON.stringify(snapshot);

    snapshot.student.firstName = 'Changed';

    expect(JSON.stringify(input)).not.toBe(original);
    expect(snapshot.student.firstName).toBe('Changed');
  });
});
