// server/modules/clinic/clinic-services/services/service.service.js
//
// ВИТРИНА 2.0 (V4.2) — сервисный слой услуг клиники.
// Зеркалит department.service.js: всегда фильтр по clinicId, code 11000 →
// ConflictError, update с runValidators, archive вместо delete, isSystem-guard.

import { ClinicService } from "../models/clinicService.model.js";
import { ClinicDepartment } from "../../clinic-departments/models/clinicDepartment.model.js";
import {
  NotFoundError,
  ConflictError,
  ValidationError,
} from "../../../../common/utils/errors.js";

// ── helpers ───────────────────────────────────────────────
function escapeRegex(str = "") {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Проверка, что departmentId принадлежит этой клинике и активен.
// null/undefined → ок (услуга вне отдела). Иначе валидация.
async function assertDepartment(clinicId, departmentId) {
  if (!departmentId) return;
  const dep = await ClinicDepartment.findOne({
    _id: departmentId,
    clinicId,
    status: "active",
  })
    .select("_id")
    .lean();
  if (!dep) {
    throw new ValidationError(
      "departmentId not found in this clinic (or archived)",
      { field: "departmentId" },
    );
  }
}

// Мягкая кросс-валидация прайса (не в zod — чтобы частичный update не падал).
// Бросаем только при явном противоречии для priceType==="range".
function validatePricing(data) {
  if (data.priceType === "range") {
    const lo = data.price;
    const hi = data.priceMax;
    if (typeof lo === "number" && typeof hi === "number" && hi < lo) {
      throw new ValidationError("priceMax must be ≥ price for range", {
        field: "priceMax",
      });
    }
  }
}

// ── CREATE ────────────────────────────────────────────────
export async function createService(clinicId, data) {
  await assertDepartment(clinicId, data.departmentId);
  validatePricing(data);

  try {
    const svc = await ClinicService.create({ ...data, clinicId });
    return svc.toObject();
  } catch (e) {
    if (e?.code === 11000) {
      throw new ConflictError("Service code already exists in this clinic", {
        field: "code",
      });
    }
    throw e;
  }
}

// ── LIST ──────────────────────────────────────────────────
// Без фильтра status возвращает ВСЁ (active + archived). Сорт по order, имени.
export async function listServices(clinicId, filters = {}) {
  const query = { clinicId };

  if (filters.status) query.status = filters.status;
  if (filters.departmentId) query.departmentId = filters.departmentId;
  if (filters.branchId) query.branchId = filters.branchId;

  if (filters.q) {
    const rx = new RegExp(escapeRegex(filters.q), "i"); // escape — защита от regex-инъекции
    query.$or = [{ name: rx }, { code: rx }];
  }

  return ClinicService.find(query).sort({ order: 1, name: 1 }).lean();
}

// ── GET BY ID ─────────────────────────────────────────────
export async function getServiceById(clinicId, id) {
  const svc = await ClinicService.findOne({ _id: id, clinicId }).lean();
  if (!svc) throw new NotFoundError("Service");
  return svc;
}

// ── UPDATE ────────────────────────────────────────────────
export async function updateService(clinicId, id, data) {
  await assertDepartment(clinicId, data.departmentId);
  validatePricing(data);

  try {
    const svc = await ClinicService.findOneAndUpdate(
      { _id: id, clinicId },
      { $set: data },
      { new: true, runValidators: true }, // runValidators — enum/min на update
    ).lean();
    if (!svc) throw new NotFoundError("Service");
    return svc;
  } catch (e) {
    if (e?.code === 11000) {
      throw new ConflictError("Service code already exists in this clinic", {
        field: "code",
      });
    }
    throw e;
  }
}

// ── ARCHIVE (soft delete) ─────────────────────────────────
// Не удаляем физически: на услугу могут ссылаться записи/счета (будущее).
// Системную услугу архивировать нельзя.
export async function archiveService(clinicId, id) {
  const svc = await ClinicService.findOne({ _id: id, clinicId });
  if (!svc) throw new NotFoundError("Service");
  if (svc.isSystem) {
    throw new ConflictError("System service cannot be archived");
  }

  svc.status = "archived";
  await svc.save();
  return svc.toObject();
}
