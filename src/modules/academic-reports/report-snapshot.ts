export type ReportSnapshot = {
  schemaVersion: 1;
  student: {
    id: string;
    admissionNumber: string | null;
    firstName: string;
    lastName: string;
    status: string;
  };
  term: {
    id: string;
    code: string;
    name: string;
    startsAt: string;
    endsAt: string;
  };
  calculation: {
    overallPercentage: number | null;
    mode: string;
    weightedAssessmentCount: number;
    unweightedAssessmentCount: number;
    totalConfiguredWeight: number | null;
  };
  subjects: Array<{
    code: string;
    name: string;
    assessmentCount: number;
    averagePercentage: number;
  }>;
  assessments: Array<{
    id: string;
    score: string;
    maxScore: string;
    percentage: number;
    weight: number | null;
    weightedContribution: number | null;
    remark: string | null;
    enteredAt: string;
    assessment: {
      id: string;
      title: string;
      type: string;
      subject: { code: string; name: string };
    };
  }>;
  grading: {
    assigned: boolean;
    reason: string | null;
    policyVersionId?: string | null;
  };
};

export function buildReportSnapshot(input: Omit<ReportSnapshot, 'schemaVersion'>): ReportSnapshot {
  return JSON.parse(JSON.stringify({ schemaVersion: 1, ...input })) as ReportSnapshot;
}

export function serializeReportSnapshot(snapshot: ReportSnapshot): string {
  return JSON.stringify(snapshot);
}
