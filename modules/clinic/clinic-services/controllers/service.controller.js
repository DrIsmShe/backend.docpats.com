// server/modules/clinic/clinic-services/controllers/service.controller.js
//
// ВИТРИНА 2.0 (V4.2) — контроллеры услуг клиники.
// Зеркалит department.controller.js: clinicId из ALS, zod через validate(),
// asyncHandler. RBAC/auth/tenant — upstream на родительском clinic-роутере.

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import { getCurrentClinicId } from "../../../../common/context/tenantContext.js";
import {
  ForbiddenError,
  ValidationError,
} from "../../../../common/utils/errors.js";
import * as serviceService from "../services/service.service.js";
import {
  createServiceSchema,
  updateServiceSchema,
  listServicesQuerySchema,
  serviceIdParamSchema,
} from "../validators/service.schemas.js";

// ── helpers ───────────────────────────────────────────────
function requireClinicId() {
  const clinicId = getCurrentClinicId();
  if (!clinicId) throw new ForbiddenError("No active clinic context");
  return clinicId;
}

function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError("Validation failed", {
      issues: result.error.issues,
    });
  }
  return result.data;
}

// ── POST /clinic/services ─────────────────────────────────
export const createService = asyncHandler(async (req, res) => {
  const clinicId = requireClinicId();
  const data = validate(createServiceSchema, req.body);
  const service = await serviceService.createService(clinicId, data);
  res.status(201).json({ service });
});

// ── GET /clinic/services ──────────────────────────────────
export const listServices = asyncHandler(async (req, res) => {
  const clinicId = requireClinicId();
  const filters = validate(listServicesQuerySchema, req.query);
  const services = await serviceService.listServices(clinicId, filters);
  res.json({ services });
});

// ── GET /clinic/services/:id ──────────────────────────────
export const getService = asyncHandler(async (req, res) => {
  const clinicId = requireClinicId();
  const { id } = validate(serviceIdParamSchema, req.params);
  const service = await serviceService.getServiceById(clinicId, id);
  res.json({ service });
});

// ── PATCH /clinic/services/:id ────────────────────────────
export const updateService = asyncHandler(async (req, res) => {
  const clinicId = requireClinicId();
  const { id } = validate(serviceIdParamSchema, req.params);
  const data = validate(updateServiceSchema, req.body);
  const service = await serviceService.updateService(clinicId, id, data);
  res.json({ service });
});

// ── DELETE /clinic/services/:id  (soft archive) ───────────
export const archiveService = asyncHandler(async (req, res) => {
  const clinicId = requireClinicId();
  const { id } = validate(serviceIdParamSchema, req.params);
  const service = await serviceService.archiveService(clinicId, id);
  res.json({ service });
});
