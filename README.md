# bci-backend-api

Core backend API for the BCI School Management System — single source of truth
for identity/auth, students, staff, academics, finance, wallet, stationery,
payroll, announcements, and messaging. Consumed by `bci-mobile-app`,
`bci-web-portal`, and `bci-website`.

See the `bci-docs` repo (https://github.com/Business-College-International/bci-docs) for full architecture,
data model rationale, and the phased build roadmap.

## Stack
Node.js + TypeScript + NestJS + Prisma + PostgreSQL.

## Getting started
```bash
cp .env.example .env       # fill in DATABASE_URL and secrets
npm install
docker compose up -d   # local Postgres
npx prisma migrate dev
npm run start:dev
```

## Module layout (`src/modules/`)
Each folder is a NestJS module, aligned to the roadmap phases:
`auth`, `users`, `students`, `applications`, `staff`, `academics`,
`attendance`, `finance`, `wallet`, `stationery`, `payroll`,
`announcements`, `messaging`.

Build them in roadmap order (Phase 0 → 6) rather than all at once —
see MASTER_PLAN.md section 9.
