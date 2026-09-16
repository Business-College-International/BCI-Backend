# Access Control Scope Hardening Milestone

## Changes

- Global `RequirePermissions(...)` checks now accept only unscoped direct user permissions.
- Role-level permissions remain global and continue to satisfy global permission checks.
- Scoped `UserPermission` records (`scopeType`/`scopeId`) no longer satisfy a global route permission by accident.
- JWT validation continues to reject inactive users and token-version mismatches.
- Director-only permission review exposes direct grants without exposing contact information.
- Permission review classifies grants as `GLOBAL` or `SCOPED` and flags scoped grants for domain-level enforcement.

## Boundary

A scoped permission is not itself a domain authorization decision. Controllers/services that support scoped access must explicitly evaluate the scope against the requested resource.

The security review endpoint is read-only. It does not mutate role or permission assignments.

## Regression coverage

- Scoped direct permission cannot satisfy a global permission requirement.
- Unscoped direct permission can satisfy a global permission requirement.
- Role-level permission can satisfy a global permission requirement.
- Permission review is director-only.
- Scoped/global assignments are classified deterministically.
