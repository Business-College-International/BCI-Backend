# Timetable Substitution Validation Milestone

## Implemented

- `POST /api/v1/timetable/substitutions/validate` protected by `academics.manage`.
- Validates original teacher assignment, active employment state, substitute employment state, term assignment eligibility, day-of-week, time range and self-substitution.
- Reuses the timetable module and existing `TeacherAssignment`/`Staff` data.
- No substitute record is persisted yet because the current Prisma schema has no substitution or availability model.

## Deliberate boundary

This is a preflight/eligibility validator, not a substitution transaction. Persisted substitutions require a dedicated schema that can represent:

- original timetable entry;
- substitute staff member;
- effective date/range;
- reason;
- approval state;
- attendance attribution;
- notification history.

The same validation service should be reused by that future write path.
