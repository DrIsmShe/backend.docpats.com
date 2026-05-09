# common/auth

RBAC primitives — granular permissions used across all clinic modules.

NOTE: This is a NEW folder. Existing auth-related code lives in:

- `common/middlewares/authMiddleware.js` (request authentication)
- `modules/auth/` (login/register)

This folder will contain (added in upcoming Sprint 0 steps):

- `permissions.js` — RESOURCES, ACTIONS, ROLE_PERMISSIONS catalog
- `can.js` — can(), require(), canFor() helpers
- `roleHierarchy.js` — canAssignRole() seniority check
