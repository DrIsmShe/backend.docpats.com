// server/common/plugins/tenantScoped.plugin.js
//
// Mongoose plugin: automatic clinicId scoping for all queries.
//
// What it does:
//   - Adds `clinicId` field to schema (required, indexed)
//   - Pre-find/update/delete hooks: automatically inject `{ clinicId: ctx.clinicId }`
//     into the query filter
//   - Pre-save hook: auto-fill clinicId from context if not set
//
// Escape hatches (use sparingly):
//   - Model.find().setOptions({ skipTenantScope: true })  → bypass scoping
//   - Model.find().setOptions({ allowMissingTenant: true }) → don't warn
//
// Usage:
//   import { tenantScopedPlugin } from "../../../common/plugins/tenantScoped.plugin.js";
//   schema.plugin(tenantScopedPlugin);

import mongoose from "mongoose";
import {
  getCurrentClinicId,
  hasActiveContext,
} from "../context/tenantContext.js";
import logger from "../logger.js";

const log = logger.child({ module: "tenantScopedPlugin" });

/**
 * Hooks that need to inject clinicId filter.
 * find* hooks read; update/delete modify; count for aggregation.
 */
const QUERY_HOOKS = [
  "find",
  "findOne",
  "findOneAndUpdate",
  "findOneAndReplace",
  "findOneAndDelete",
  "count",
  "countDocuments",
  "estimatedDocumentCount",
  "updateOne",
  "updateMany",
  "deleteOne",
  "deleteMany",
  "replaceOne",
];

export function tenantScopedPlugin(schema, pluginOptions = {}) {
  // 1. Add clinicId field if not already present
  if (!schema.path("clinicId")) {
    schema.add({
      clinicId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Clinic",
        required: true,
        index: true,
      },
    });
  }

  // 2. Add hooks for query operations
  QUERY_HOOKS.forEach((hookName) => {
    schema.pre(hookName, function (next) {
      const opts = this.getOptions ? this.getOptions() : {};

      // Escape hatch
      if (opts.skipTenantScope === true) {
        return next();
      }

      const clinicId = getCurrentClinicId();

      if (!clinicId) {
        // No active context → typical for cron jobs, seeds, system tasks
        if (!opts.allowMissingTenant) {
          const collectionName =
            this.mongooseCollection?.name ||
            schema.options?.collection ||
            "(unknown)";
          log.warn(
            {
              hook: hookName,
              collection: collectionName,
              hasActiveCtx: hasActiveContext(),
            },
            `tenantScopedPlugin: ${hookName} on ${collectionName} without clinicId in context`,
          );
        }
        return next();
      }

      // Inject clinicId filter
      const filter = this.getFilter ? this.getFilter() : {};
      if (filter.clinicId === undefined) {
        this.where({ clinicId });
      }
      // If clinicId is already in filter, we trust caller — but verify it matches
      else if (String(filter.clinicId) !== String(clinicId)) {
        const collectionName =
          this.mongooseCollection?.name ||
          schema.options?.collection ||
          "(unknown)";
        log.error(
          {
            hook: hookName,
            collection: collectionName,
            requestedClinicId: String(filter.clinicId),
            contextClinicId: String(clinicId),
          },
          `tenantScopedPlugin: cross-tenant query attempt blocked`,
        );
        return next(new Error("Cross-tenant query denied"));
      }

      next();
    });
  });

  // 3. Pre-save: auto-fill clinicId from context if not set
  schema.pre("validate", function (next) {
    if (this.isNew && !this.clinicId) {
      const clinicId = getCurrentClinicId();
      if (clinicId) {
        this.clinicId = clinicId;
      }
      // Don't error here — let mongoose's required validation catch it
    }
    next();
  });
  // 4. Pre-insertMany: same as save, but for bulk inserts
  schema.pre("insertMany", function (next, docs) {
    const clinicId = getCurrentClinicId();
    if (clinicId && Array.isArray(docs)) {
      docs.forEach((doc) => {
        if (doc && !doc.clinicId) {
          doc.clinicId = clinicId;
        }
      });
    }
    next();
  });
}

/**
 * Mark a model as tenant-scoped without applying the plugin.
 * Useful for static analysis / documentation.
 */
export function isTenantScoped(schema) {
  return Boolean(schema.path("clinicId"));
}
