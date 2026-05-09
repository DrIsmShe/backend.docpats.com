# common/context

AsyncLocalStorage-based per-request context.

Stores: `userId`, `clinicId`, `role`, `permissions`.
Used by tenantMiddleware, mongoose plugins, and service-layer code.

Files (will be added):

- `tenantContext.js`
