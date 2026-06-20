// server/modules/clinic/clinic-departments/controllers/department.controller.js

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import { getCurrentClinicId } from "../../../../common/context/tenantContext.js";
import {
  ForbiddenError,
  ValidationError,
} from "../../../../common/utils/errors.js";
import * as departmentService from "../services/department.service.js";
import {
  createDepartmentSchema,
  updateDepartmentSchema,
  setDepartmentHeadSchema,
  listDepartmentsQuerySchema,
  departmentIdParamSchema,
} from "../validators/department.schemas.js";

// ── helpers ───────────────────────────────────────────────
// clinicId резолвится из ALS tenant-контекста (tenantMiddleware ставит его
// выше по стеку — и для user-owner, и для ClinicEmployee).
function requireClinicId() {
  const clinicId = getCurrentClinicId();
  if (!clinicId) throw new ForbiddenError("No active clinic context");
  return clinicId;
}

// Zod safeParse → ValidationError (центральный errorHandler отдаст 400).
function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError("Validation failed", {
      issues: result.error.issues,
    });
  }
  return result.data;
}

// ── POST /clinic/departments ──────────────────────────────
export const createDepartment = asyncHandler(async (req, res) => {
  const clinicId = requireClinicId();
  const data = validate(createDepartmentSchema, req.body);
  const department = await departmentService.createDepartment(clinicId, data);
  res.status(201).json({ department });
});

// ── GET /clinic/departments ───────────────────────────────
export const listDepartments = asyncHandler(async (req, res) => {
  const clinicId = requireClinicId();
  const filters = validate(listDepartmentsQuerySchema, req.query);
  const departments = await departmentService.listDepartments(
    clinicId,
    filters,
  );
  res.json({ departments });
});

// ── GET /clinic/departments/:id ───────────────────────────
export const getDepartment = asyncHandler(async (req, res) => {
  const clinicId = requireClinicId();
  const { id } = validate(departmentIdParamSchema, req.params);
  const department = await departmentService.getDepartmentById(clinicId, id);
  res.json({ department });
});

// ── PATCH /clinic/departments/:id ─────────────────────────
export const updateDepartment = asyncHandler(async (req, res) => {
  const clinicId = requireClinicId();
  const { id } = validate(departmentIdParamSchema, req.params);
  const data = validate(updateDepartmentSchema, req.body);
  const department = await departmentService.updateDepartment(
    clinicId,
    id,
    data,
  );
  res.json({ department });
});

// ── PATCH /clinic/departments/:id/head ────────────────────
export const setDepartmentHead = asyncHandler(async (req, res) => {
  const clinicId = requireClinicId();
  const { id } = validate(departmentIdParamSchema, req.params);
  const { headMembershipId } = validate(setDepartmentHeadSchema, req.body);
  const department = await departmentService.setDepartmentHead(
    clinicId,
    id,
    headMembershipId,
  );
  res.json({ department });
});

// ── DELETE /clinic/departments/:id  (soft archive) ────────
export const archiveDepartment = asyncHandler(async (req, res) => {
  const clinicId = requireClinicId();
  const { id } = validate(departmentIdParamSchema, req.params);
  const department = await departmentService.archiveDepartment(clinicId, id);
  res.json({ department });
});
