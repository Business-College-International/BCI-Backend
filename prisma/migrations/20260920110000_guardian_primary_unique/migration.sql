-- Enforce the one-primary-guardian invariant at the database boundary.
-- Fail the migration rather than silently selecting/deleting a guardian if
-- existing data already violates the invariant.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "GuardianStudent"
    WHERE "isPrimaryContact" = true
    GROUP BY "studentId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot create GuardianStudent_one_primary_per_student: existing data contains multiple primary guardians for at least one student.';
  END IF;
END $$;

CREATE UNIQUE INDEX "GuardianStudent_one_primary_per_student"
ON "GuardianStudent" ("studentId")
WHERE "isPrimaryContact" = true;
