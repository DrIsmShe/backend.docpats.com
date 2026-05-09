// server/common/plugins/standardModel.plugin.js
//
// Convenience plugin: applies all "standard" plugins for clinic models.
// Use this in 99% of cases instead of calling each plugin separately.
//
// Usage:
//   import { standardModelPlugin } from "../../../common/plugins/standardModel.plugin.js";
//   schema.plugin(standardModelPlugin);
//
// What it includes:
//   - tenantScopedPlugin (clinicId scoping)
//   - softDeletePlugin (isDeleted/deletedAt/deletedBy)
//   - timestamps (createdAt/updatedAt) — already enabled if schema has { timestamps: true }
//
// To opt out of any plugin:
//   schema.plugin(standardModelPlugin, { skipSoftDelete: true });

import { tenantScopedPlugin } from "./tenantScoped.plugin.js";
import { softDeletePlugin } from "./softDelete.plugin.js";

export function standardModelPlugin(schema, options = {}) {
  if (!options.skipTenantScope) {
    schema.plugin(tenantScopedPlugin);
  }
  if (!options.skipSoftDelete) {
    schema.plugin(softDeletePlugin);
  }
}
