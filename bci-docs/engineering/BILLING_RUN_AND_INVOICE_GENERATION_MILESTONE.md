# Billing Run and Invoice Generation Milestone

## Delivered

- Batch billing preview and execution for active term enrolments.
- Optional fee items excluded by default and included only when explicitly requested.
- Fee schedules must match enrolment level and programme.
- Students with an existing OPEN/PARTIALLY_PAID invoice for the term are skipped before execution.
- Closed terms cannot be billed.
- Student and fee-schedule changes are revalidated inside the execution transaction.
- Invoice lines snapshot the current fee amount and item description; later master-data changes do not rewrite issued invoices.
- Billing execution uses PostgreSQL SERIALIZABLE isolation and surfaces serialization conflicts as retryable conflicts.
- Billing run, invoice creation, and line totals are audited.
- Due dates are validated before preview and execution.

## Office workflow

1. Select term.
2. Optionally select class.
3. Optionally choose a due date.
4. Choose whether optional charges should be included.
5. Preview candidates, skip reasons, and estimated total.
6. Execute only after reviewing the preview.

## Financial boundary

Billing creates invoices only. It does not create payments, reserve provider funds, allocate payments, or claim successful collection.

## Next gate

The next financial step remains the durable payment reservation migration and verified provider initiation path.
