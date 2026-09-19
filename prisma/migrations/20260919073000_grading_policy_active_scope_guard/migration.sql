-- Enforce one active policy per academic-year/level/programme scope at the database layer.
CREATE UNIQUE INDEX "GradingPolicy_active_programme_scope_key"
ON "GradingPolicy" ("academicYearId", "level", "programme")
WHERE "status" = 'ACTIVE' AND "programme" IS NOT NULL;

-- Generic policies use a null programme, so they need their own uniqueness scope.
CREATE UNIQUE INDEX "GradingPolicy_active_generic_scope_key"
ON "GradingPolicy" ("academicYearId", "level")
WHERE "status" = 'ACTIVE' AND "programme" IS NULL;
