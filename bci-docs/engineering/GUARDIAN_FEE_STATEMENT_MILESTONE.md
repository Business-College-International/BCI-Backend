# Guardian Fee Statement Milestone

## Completed
- Added a guardian-safe fee statement endpoint at `GET /api/v1/finance/students/:studentId/statement`.
- Reuses the authoritative `StudentInvoice`, `InvoiceLine`, `PaymentAllocation`, `Payment`, and `Receipt` records.
- Fee access is restricted to authorized finance staff or a linked guardian with `canPayFees=true`.
- Invoice paid/outstanding values count only allocations attached to `SUCCEEDED` `FEE` payments.
- The receipt section includes only successful `FEE` payments, preventing wallet/stationery transactions from appearing as school-fee receipts.
- All money calculations use `Prisma.Decimal`.
- Added backend regression tests for totals, guardian access control, and the fee-purpose query boundary.
- Added the guardian web portal statement view with ward selection, invoice summary, outstanding balances, and receipt history.

## Deliberate boundaries
- No payment initiation is performed by the statement endpoint.
- No provider callback changes are made by the statement endpoint.
- Receipt files remain whatever is stored on the canonical `Receipt.fileUrl` record; the statement does not fabricate downloadable documents.

## Next financial gates
- Durable payment reservation migration.
- Verified provider initiation/webhook contract.
- Reconciliation between provider settlement, allocation, receipt, and journal entries.
- Mobile presentation parity after the backend statement contract is verified.
