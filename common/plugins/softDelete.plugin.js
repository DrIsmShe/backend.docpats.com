// server/common/plugins/softDelete.plugin.js
//
// Mongoose plugin: soft delete (never physically remove PHI).
//
// What it does:
//   - Adds isDeleted, deletedAt, deletedBy fields to schema
//   - Pre-find hooks: automatically filter out { isDeleted: true }
//   - Adds instance methods: doc.softDelete(), doc.restore()
//
// Escape hatches:
//   - Model.find().setOptions({ includeDeleted: true })  → see soft-deleted records
//   - Model.find({ isDeleted: true })                    → explicit override
//
// IMPORTANT: deletedBy is set from tenant context (current user).

import mongoose from "mongoose";
import { getCurrentUserId } from "../context/tenantContext.js";

const FIND_HOOKS = [
  "find",
  "findOne",
  "findOneAndUpdate",
  "findOneAndReplace",
  "findOneAndDelete",
  "count",
  "countDocuments",
];

export function softDeletePlugin(schema, pluginOptions = {}) {
  // 1. Add fields
  schema.add({
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  });

  // 2. Auto-filter out deleted records on find/count
  FIND_HOOKS.forEach((hookName) => {
    schema.pre(hookName, function (next) {
      const opts = this.getOptions ? this.getOptions() : {};
      if (opts.includeDeleted === true) {
        return next();
      }

      const filter = this.getFilter ? this.getFilter() : {};
      // If user explicitly queries by isDeleted, respect their intent
      if (filter.isDeleted === undefined) {
        this.where({ isDeleted: { $ne: true } });
      }
      next();
    });
  });

  // 3. Instance methods
  schema.methods.softDelete = async function () {
    this.isDeleted = true;
    this.deletedAt = new Date();
    this.deletedBy = getCurrentUserId();
    return this.save();
  };

  schema.methods.restore = async function () {
    this.isDeleted = false;
    this.deletedAt = null;
    this.deletedBy = null;
    return this.save();
  };

  // 4. Static helpers
  schema.statics.findIncludingDeleted = function (filter = {}) {
    return this.find(filter).setOptions({ includeDeleted: true });
  };

  schema.statics.findOnlyDeleted = function (filter = {}) {
    return this.find({ ...filter, isDeleted: true }).setOptions({
      includeDeleted: true,
    });
  };
}

/**
 * Check if a schema has soft delete enabled.
 */
export function hasSoftDelete(schema) {
  return Boolean(schema.path("isDeleted"));
}
