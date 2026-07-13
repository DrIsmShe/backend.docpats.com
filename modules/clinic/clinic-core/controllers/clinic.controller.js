// modules/clinic/clinic-core/controllers/clinic.controller.js

import * as service from "../services/clinic.service.js";
import {
  createClinicSchema,
  updateClinicSchema,
  publishClinicSchema,
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
import { deleteClinicCascade } from "../services/deleteClinicCascade.service.js";

/**
 * ВИТРИНА / site_builder — набор полей публичной страницы клиники, которые
 * маркетолог (роль marketer, право site_builder.write) может редактировать
 * БЕЗ права clinic.write. Всё, что НЕ в этом наборе (name, slug, tier,
 * contacts, timezone, defaultCurrency, ...), остаётся ядром клиники и требует
 * clinic.write (owner/admin).
 *
 * Логика гейта (assertCanEditFields):
 *   - если запрос трогает ТОЛЬКО витринные поля → site_builder.write ИЛИ clinic.write
 *   - если есть хоть один ключ вне набора → нужен clinic.write
 * Владелец/админ (clinic.write) работают как раньше — набор их не ограничивает.
 */
const SITE_BUILDER_FIELDS = new Set([
  "theme",
  "layout",
  "description",
  "logo",
  "gallery",
  "isPublished",
  "coverImage",
  "pageBackground",
]);

/**
 * Проверяет права на изменение конкретного набора полей.
 * @param {string[]} keys — ключи, которые реально пришли в запросе (после Zod)
 * @throws {ForbiddenError}
 */
function assertCanEditFields(keys) {
  const touchesCoreOnly = keys.some((k) => !SITE_BUILDER_FIELDS.has(k));

  if (touchesCoreOnly) {
    // затронуто ядро клиники — только clinic.write
    if (!can("clinic", "write")) {
      throw new ForbiddenError("clinic.write permission required");
    }
    return;
  }

  // затронуты только витринные поля — site_builder.write ИЛИ clinic.write
  if (!can("site_builder", "write") && !can("clinic", "write")) {
    throw new ForbiddenError(
      "site_builder.write or clinic.write permission required",
    );
  }
}

/**
 * POST /api/v1/clinic/clinics
 *
 * Only verified DocPats DOCTORS can create a clinic and become its owner.
 * Patients and other user types are explicitly forbidden — clinic ownership
 * is a medical-professional-only capability.
 *
 * No tenant context required (this IS the bootstrap of a tenant).
 */
export async function createClinic(req, res, next) {
  try {
    const userId = req.session?.userId;
    if (!userId) throw new UnauthorizedError();

    // Verify the requester is a registered DocPats doctor.
    // Load the user fresh from DB — never trust session state for authorization.
    const User = (await import("../../../../common/models/Auth/users.js"))
      .default;
    const user = await User.findById(userId).select(
      "_id isDoctor isPatient isBlocked role",
    );

    if (!user) {
      throw new UnauthorizedError("User not found");
    }
    if (user.isBlocked) {
      throw new ForbiddenError("Account is blocked");
    }
    if (!user.isDoctor) {
      throw new ForbiddenError(
        "Only verified DocPats doctors can create a clinic",
      );
    }

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
 * Update clinic profile.
 * Права зависят от затронутых полей (см. assertCanEditFields):
 *   - только витринные поля  → site_builder.write ИЛИ clinic.write (маркетолог)
 *   - поля ядра клиники      → clinic.write (owner/admin)
 * Поддерживает brand/витрина-поля (description/logo/gallery/theme/layout/…)
 * — см. updateClinicSchema.
 */
export async function updateClinic(req, res, next) {
  try {
    const { id } = req.params;
    const currentClinicId = getCurrentClinicId();

    // Cross-tenant guard: cannot update other clinics
    if (String(currentClinicId) !== String(id)) {
      throw new ForbiddenError("Cannot update another clinic");
    }

    const parsed = updateClinicSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid update data", {
        issues: parsed.error.issues,
      });
    }

    // Гейт по фактически переданным полям (field-level RBAC).
    // Пустой запрос трактуем как отсутствие изменений витрины → минимальный гейт.
    const keys = Object.keys(parsed.data);
    if (keys.length === 0) {
      // ничего не пришло — не пропускаем молча, требуем хотя бы витринное право
      assertCanEditFields([]);
    } else {
      assertCanEditFields(keys);
    }

    const updated = await service.updateClinic(id, parsed.data);
    res.json({ clinic: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/v1/clinic/clinics/:id/publish
 *
 * Clinic-as-Brand (этап A): тумблер видимости публичной страницы /clinic/:slug.
 * Cross-tenant guard + витринный гейт: меняется только isPublished (витринное
 * поле) → site_builder.write ИЛИ clinic.write (маркетолог тоже может).
 * body: { isPublished: boolean }
 */
export async function setClinicPublished(req, res, next) {
  try {
    const { id } = req.params;
    const currentClinicId = getCurrentClinicId();

    if (String(currentClinicId) !== String(id)) {
      throw new ForbiddenError("Cannot modify another clinic");
    }

    // isPublished входит в SITE_BUILDER_FIELDS → маркетолог допускается
    assertCanEditFields(["isPublished"]);

    const parsed = publishClinicSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid publish data", {
        issues: parsed.error.issues,
      });
    }

    const updated = await service.updateClinic(id, {
      isPublished: parsed.data.isPublished,
    });
    res.json({ clinic: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/clinic/public/:slug
 *
 * ⚠ LEGACY: устаревший публичный эндпоинт (урезанный clinic, без врачей/галереи).
 * Новый публичный путь — GET /api/v1/public/clinics/:slug (модуль clinic-public).
 * Оставлен временно; удалить на этапе cleanup (сверить, что getClinicBySlug
 * больше нигде не используется).
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

/**
 * DELETE /api/v1/clinic/clinics/:id
 *
 * Cascade-delete a clinic (OWNER only). Requires a typed confirmation of the
 * clinic name in the body to guard against accidental deletion.
 *
 * Hybrid strategy (see deleteClinicCascade.service.js):
 *   - HARD delete: construction/public data (departments, rooms, articles, …)
 *   - SOFT delete: PHI/history (patients, appointments, consilia, memberships,
 *     the clinic itself) — kept for audit/compliance.
 *   - Global ClinicEmployee identities are NOT deleted (only their memberships
 *     to this clinic are ended).
 *
 * body: { confirmationName: string }  — must equal the clinic's exact name.
 */
export async function deleteClinic(req, res, next) {
  try {
    const userId = req.session?.userId;
    if (!userId) throw new UnauthorizedError();

    const { id } = req.params;
    const currentClinicId = getCurrentClinicId();

    // Cross-tenant guard: can only delete the clinic you're active in.
    if (String(currentClinicId) !== String(id)) {
      throw new ForbiddenError("Cannot delete another clinic");
    }

    const confirmationName =
      typeof req.body?.confirmationName === "string"
        ? req.body.confirmationName
        : "";

    // Owner-only gate + name confirmation are enforced inside the service.
    const result = await deleteClinicCascade({
      clinicId: id,
      actorUserId: userId,
      confirmationName,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}
