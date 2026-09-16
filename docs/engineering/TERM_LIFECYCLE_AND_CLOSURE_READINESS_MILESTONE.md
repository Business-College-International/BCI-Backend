# Term Lifecycle and Closure Readiness Milestone

## Changes

- Term creation now rejects overlapping date ranges within an academic year.
- Opening a term closes only an already-open term in the same academic year; draft terms remain draft.
- Invalid DRAFT -> OPEN and OPEN -> CLOSED transitions remain rejected.
- Added `GET /api/v1/terms/:id/closure-readiness` behind `academics.read`.

## Closure-readiness signals

The readiness report is advisory rather than an automatic close gate. It reports:

- active enrolment count;
- assessment count and result count;
- active students missing one or more assessment results;
- attendance session count and published-session count;
- whether the term end date has been reached;
- explicit blockers including `TERM_END_NOT_REACHED`, `NO_ASSESSMENTS`, `MISSING_ASSESSMENT_RESULTS`, and `UNPUBLISHED_ATTENDANCE_SESSIONS`.

## UI

The Academic Control Center now displays closure readiness beside each open term.

## Deliberate boundary

Closing a term is still an explicit administrative action. The readiness report does not silently mutate term state or block closure based on assumptions about school policy.
