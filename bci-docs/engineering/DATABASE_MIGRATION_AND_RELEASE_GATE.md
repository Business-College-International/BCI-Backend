# BCI Database Migration and Release Gate

## Purpose

The BCI backend currently has an authoritative Prisma schema but no committed canonical Prisma migration history. This is a release-engineering constraint, not something application code should work around.

## Rules

1. `postgres-schema-contract.yml` validates that the Prisma datamodel can build a clean PostgreSQL schema, that the generated database matches the datamodel, and that the backend builds/tests against PostgreSQL.
2. `prisma-migration-review.yml` produces the database delta for review. It is never a production deployment mechanism.
3. When `prisma/migrations` is absent, the generated SQL is a **baseline artifact only**. It must not be applied as an incremental production migration.
4. Once canonical migrations exist, a schema change must have a reviewed migration delta before release.
5. Destructive operations such as `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, and `DROP SCHEMA` are review blockers in the automated migration-review gate.
6. Production deployment must use `prisma migrate deploy` against an explicitly approved environment, not `prisma db push` and not a generated-from-empty SQL artifact.
7. Financially significant schema changes require application-level invariants and concurrency tests before the migration is considered release-ready.

## Required first live-database milestone

Before BCI operates against a real school database, establish a canonical initial Prisma migration from the current authoritative schema. Review the migration, apply it to a clean PostgreSQL database, run the full backend test suite, and record the resulting migration identifier in the release notes.

## Required future migration contents

The first controlled migration series must include the already identified structural requirements, including:

- proper student-to-emergency-contact relationship;
- database enforcement for at most one primary guardian per student;
- payment reservation state and idempotency constraints;
- any persisted timetable/substitution models that have passed their domain-contract reviews;
- persistent grading/report-publication policy models;
- any additional schema required by verified provider integrations.

## Release sequence

Schema proposal → migration generation → migration review → clean PostgreSQL apply → backend build/tests → application integration checks → staged deployment → production migration via `prisma migrate deploy` → post-deploy reconciliation.
