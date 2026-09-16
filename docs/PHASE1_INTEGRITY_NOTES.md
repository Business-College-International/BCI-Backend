# Phase 1 Integrity Notes

## Admission capacity

Class-capacity checks must be serialized per `(termId, classId)` during admission. A read-then-insert sequence can otherwise allow two concurrent admissions to both observe a free seat and exceed the configured capacity. The admission service therefore takes a PostgreSQL transaction advisory lock before counting active enrolments and creating the enrolment.

The database model remains the source of truth for enrolment uniqueness; the advisory lock protects the cross-row capacity invariant.

## Public application endpoints

Application submission is rate-limited separately from general traffic. Public tracking lookups are also treated as a sensitive application endpoint so repeated tracking-code probing is bounded.
