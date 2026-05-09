// modules/clinic/clinic-core/controllers/clinic.controller.js

import * as service from "../services/clinic.service.js";
import {
  createClinicSchema,
  updateClinicSchema,
} from "../validators/clinic.schemas.js";
import {
  UnauthorizedError,
  ValidationError,
  ForbiddenError,
} from "../../../../common/utils/errors.js";
import {
  getCurrentUserId,
  getCurrentClinicId,
} from "../../../../common/context/tenantContext.js";
import { can } from "../../../../common/auth/can.js";

/**
 * POST /api/v1/clinic/clinics
 *
 * Anyone authenticated can create a clinic and become its owner.
 * No tenant context required (this IS the bootstrap of a tenant).
 */
export async function createClinic(req, res, next) {
  try {
    const userId = req.session?.userId;
    if (!userId) throw new UnauthorizedError();

    // Validate body
    const parsed = createClinicSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid clinic data", {
        issues: parsed.error.issues,
      });
    }

    const { clinic, membership } = await service.createClinic(
      parsed.data,
      userId,
    );

    res.status(201).json({
      clinic: {
        id: String(clinic._id),
        name: clinic.name,
        slug: clinic.slug,
        tier: clinic.tier,
        timezone: clinic.timezone,
        defaultCurrency: clinic.defaultCurrency,
        defaultLanguage: clinic.defaultLanguage,
        ownerId: String(clinic.ownerId),
        createdAt: clinic.createdAt,
      },
      membership: {
        id: String(membership._id),
        role: membership.role,
        isPrimary: membership.isPrimary,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/clinic/clinics/me
 *
 * Returns the clinic of the current user (active membership).
 * Requires tenant context.
 */
export async function getMyClinic(req, res, next) {
  try {
    const clinicId = getCurrentClinicId();
    if (!clinicId) {
      throw new ForbiddenError("No active clinic membership");
    }
    const clinic = await service.getClinicById(clinicId);
    res.json({ clinic });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/v1/clinic/clinics/:id
 *
 * Update clinic profile. Requires "clinic.write" permission.
 */
export async function updateClinic(req, res, next) {
  try {
    const { id } = req.params;
    const currentClinicId = getCurrentClinicId();

    // Cross-tenant guard: cannot update other clinics
    if (String(currentClinicId) !== String(id)) {
      throw new ForbiddenError("Cannot update another clinic");
    }

    if (!can("clinic", "write")) {
      throw new ForbiddenError("clinic.write permission required");
    }

    const parsed = updateClinicSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid update data", {
        issues: parsed.error.issues,
      });
    }

    const updated = await service.updateClinic(id, parsed.data);
    res.json({ clinic: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/clinic/public/:slug
 *
 * Public-facing clinic page (no auth needed).
 */
export async function getPublicClinic(req, res, next) {
  try {
    const { slug } = req.params;
    const clinic = await service.getClinicBySlug(slug);

    // Strip internal/sensitive fields for public response
    res.json({
      clinic: {
        id: String(clinic._id),
        name: clinic.name,
        slug: clinic.slug,
        contacts: clinic.contacts,
        address: clinic.address,
        timezone: clinic.timezone,
        defaultLanguage: clinic.defaultLanguage,
        supportedLanguages: clinic.supportedLanguages,
        specializations: clinic.specializations,
        isVerified: clinic.isVerified,
      },
    });
  } catch (err) {
    next(err);
  }
}
