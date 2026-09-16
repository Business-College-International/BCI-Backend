# BCI Fee Schedule Lifecycle Milestone

## Completed

- Fee schedules remain authoritative master data for invoice generation.
- New fee items cannot be added to closed terms.
- Finance managers can rename fee items, change optional/required state, and activate/deactivate an item.
- Every fee-schedule update is audited.
- Fee amount changes are blocked once the schedule item has been used on an invoice line. A replacement fee item must be created instead so issued invoices retain historical pricing.
- The web configuration workspace exposes only the safe lifecycle edits; monetary edits are deliberately not offered there.

## Boundary

Fee schedule mutation does not mutate existing student invoices. Invoice lines remain the historical financial snapshot for what was actually charged.

## Next Gate

Fee schedule-to-invoice generation should validate that only active schedule items are offered and should preserve optional-item semantics. Any live collection flow remains behind the payment reservation/provider gates.
