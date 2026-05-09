# common/utils

Generic utility modules used across the entire application.

## Existing files (legacy)

- `initSpecializations.js` — initializes specialization registry on startup
- (other existing utilities, do not move)

## New files (added during Sprint 0 — clinic foundation)

- `money.js` — Money class (integer minor units + currency)
- `errors.js` — AppError, ValidationError, NotFoundError, ForbiddenError
- `signedUrl.js` — JWT-signed time-limited URLs for public resources
- `timezone.js` — Luxon-based timezone helpers

## Where to put new utilities?

If a utility:

- Is used outside clinic-modules → put it here in `common/utils/`
- Is used only by clinic-modules and 2+ submodules → `modules/clinic/_shared/helpers/`
- Is used only in one submodule → directly in that submodule

## Note

There is also `server/utils/` (root-level) for very early utilities
(crypto, hashEmail, db, etc.). New code should go to `common/utils/` instead.
