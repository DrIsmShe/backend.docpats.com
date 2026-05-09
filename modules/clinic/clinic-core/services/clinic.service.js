// modules/clinic/clinic-core/services/clinic.service.js
//
// Business logic for clinic CRUD operations.

import mongoose from "mongoose";
import Clinic from "../models/clinic.model.js";
import ClinicMembership from "../../clinic-staff/models/clinicMembership.model.js";
import { eventBus, EVENTS } from "../../../../common/events/eventBus.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../../../common/utils/errors.js";
import logger from "../../../../common/logger.js";
import { ROLES } from "../../../../common/auth/permissions.js";

const log = logger.child({ module: "clinic-core/service" });

/**
 * Create a new clinic and auto-assign the creator as owner.
 * Atomic: clinic + owner-membership are created in one transaction.
 *
 * @param {object} data — validated clinic data
 * @param {string|ObjectId} ownerId — user creating the clinic
 * @returns {Promise<{clinic, membership}>}
 */
export async function createClinic(data, ownerId) {
  if (!ownerId) {
    throw new ValidationError("ownerId is required to create a clinic");
  }

  // Auto-generate slug if not provided
  let slug = data.slug;
  if (!slug && data.name) {
    slug = Clinic.generateSlug(data.name);
  }

  // Check slug uniqueness BEFORE starting transaction (clean error message)
  const slugExists = await Clinic.findOne({ slug })
    .setOptions({ skipTenantScope: true })
    .lean();
  if (slugExists) {
    throw new ConflictError(`Clinic with slug "${slug}" already exists`, {
      field: "slug",
    });
  }

  const session = await mongoose.startSession();
  let clinic;
  let membership;

  try {
    await session.withTransaction(async () => {
      // 1. Create clinic
      const [created] = await Clinic.create([{ ...data, slug, ownerId }], {
        session,
      });
      clinic = created;

      // 2. Create owner membership (skip tenant context — this IS the bootstrap)
      const [createdMembership] = await ClinicMembership.create(
        [
          {
            userId: ownerId,
            clinicId: clinic._id,
            role: ROLES.OWNER,
            isPrimary: true,
            isActive: true,
            joinedAt: new Date(),
          },
        ],
        { session },
      );
      membership = createdMembership;
    });
  } finally {
    await session.endSession();
  }

  log.info(
    {
      clinicId: String(clinic._id),
      ownerId: String(ownerId),
      slug: clinic.slug,
    },
    "Clinic created with owner membership",
  );

  // Emit event (after transaction so listeners see committed data)
  eventBus.emitSafe(EVENTS.CLINIC_CREATED, {
    clinicId: String(clinic._id),
    ownerId: String(ownerId),
    slug: clinic.slug,
    name: clinic.name,
    tier: clinic.tier,
  });

  return { clinic, membership };
}

/**
 * Get a clinic by id (respects tenant scope via softDelete plugin).
 * Returns null if soft-deleted or not found.
 */
export async function getClinicById(clinicId) {
  const clinic = await Clinic.findById(clinicId);
  if (!clinic) throw new NotFoundError("Clinic");
  return clinic;
}

/**
 * Get clinic by slug (used by public site).
 * No auth required, hence skipTenantScope.
 */
export async function getClinicBySlug(slug) {
  const clinic = await Clinic.findOne({ slug, isActive: true }).setOptions({
    skipTenantScope: true,
  });
  if (!clinic) throw new NotFoundError("Clinic");
  return clinic;
}

/**
 * Update clinic profile.
 * Caller must verify permissions BEFORE calling this (controller layer).
 */
export async function updateClinic(clinicId, updates) {
  // Filter out fields that should not be updated via this endpoint
  const forbidden = ["ownerId", "_id", "createdAt", "isVerified", "verifiedAt"];
  const safe = { ...updates };
  forbidden.forEach((k) => delete safe[k]);

  // If slug is being changed, ensure uniqueness
  if (safe.slug) {
    const exists = await Clinic.findOne({
      slug: safe.slug,
      _id: { $ne: clinicId },
    })
      .setOptions({ skipTenantScope: true })
      .lean();
    if (exists) {
      throw new ConflictError(`Slug "${safe.slug}" is already taken`, {
        field: "slug",
      });
    }
  }

  const updated = await Clinic.findByIdAndUpdate(
    clinicId,
    { $set: safe },
    { new: true, runValidators: true },
  );
  if (!updated) throw new NotFoundError("Clinic");

  log.info(
    { clinicId: String(clinicId), updates: Object.keys(safe) },
    "Clinic updated",
  );

  eventBus.emitSafe(EVENTS.CLINIC_UPDATED, {
    clinicId: String(clinicId),
    fields: Object.keys(safe),
  });

  return updated;
}
