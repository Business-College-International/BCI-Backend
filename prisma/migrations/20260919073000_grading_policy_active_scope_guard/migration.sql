-- Enforce one active policy per academic-year/level/programme scope at the database layer.
CREATE UNIQUE INDEX "GradingPolicy_active_scope_key"
ON "GradingPolicy" (
  "academicYearId",
  "level",
  COALESCE("programme"::text, '__GENERIC__')
)
WHERE "status" = 'ACTIVE';
