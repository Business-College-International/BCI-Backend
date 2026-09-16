# Assessment Integrity and Term Lock Milestone

## Implemented

- Assessment creation already rejects closed terms and validates score/weight bounds.
- Teacher assessment writes are assignment-scoped by term/subject/class.
- Student scores must be within `0..maxScore` using `Prisma.Decimal`.
- Duplicate student result rows in a single request are rejected.
- Assessment result updates are now blocked after the linked term is `CLOSED` by `AssessmentWriteGuard`.
- Assessment records remain readable after closure for reporting and audit purposes.

## Lifecycle rule

`OPEN` term: assessment creation and result entry are allowed subject to normal authorization and academic scope.

`CLOSED` term: assessment data is read-only. Existing results remain available for report generation, readiness checks, and audit review.

## Future report-card gate

The next academic persistence layer remains the grading-policy/report-snapshot model. Closing a term is now a firm input to that future publication workflow.
