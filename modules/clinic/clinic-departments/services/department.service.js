// server/modules/clinic/clinic-departments/services/department.service.js

import { ClinicDepartment } from "../models/clinicDepartment.model.js";
import {
  NotFoundError,
  ConflictError,
  ValidationError,
} from "../../../../common/utils/errors.js";

// ── helpers ───────────────────────────────────────────────
function escapeRegex(str = "") {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── CREATE ────────────────────────────────────────────────
export async function createDepartment(clinicId, data) {
  if (data.parentDepartmentId) {
    const parent = await ClinicDepartment.findOne({
      _id: data.parentDepartmentId,
      clinicId,
    })
      .select("_id")
      .lean();
    if (!parent) {
      throw new ValidationError("parentDepartmentId not found in this clinic", {
        field: "parentDepartmentId",
      });
    }
  }

  try {
    const dep = await ClinicDepartment.create({ ...data, clinicId });
    return dep.toObject();
  } catch (e) {
    if (e?.code === 11000) {
      throw new ConflictError("Department code already exists in this clinic", {
        field: "code",
      });
    }
    throw e;
  }
}

// ── LIST ──────────────────────────────────────────────────
// Без фильтра status возвращает ВСЁ (active + archived).
// UI-дропдаун записи пусть передаёт status="active".
export async function listDepartments(clinicId, filters = {}) {
  const query = { clinicId };

  if (filters.status) query.status = filters.status;
  if (filters.branchId) query.branchId = filters.branchId;
  if (filters.specialty) query.specialty = filters.specialty;
  if (filters.parentDepartmentId)
    query.parentDepartmentId = filters.parentDepartmentId;

  if (filters.q) {
    const rx = new RegExp(escapeRegex(filters.q), "i"); // escape — защита от regex-инъекции
    query.$or = [{ name: rx }, { code: rx }];
  }

  return ClinicDepartment.find(query).sort({ name: 1 }).lean();
}

// ── GET BY ID ─────────────────────────────────────────────
export async function getDepartmentById(clinicId, id) {
  const dep = await ClinicDepartment.findOne({ _id: id, clinicId }).lean();
  if (!dep) throw new NotFoundError("Department");
  return dep;
}

// ── UPDATE ────────────────────────────────────────────────
export async function updateDepartment(clinicId, id, data) {
  if (data.parentDepartmentId) {
    if (String(data.parentDepartmentId) === String(id)) {
      throw new ValidationError("Department cannot be its own parent", {
        field: "parentDepartmentId",
      });
    }
    const parent = await ClinicDepartment.findOne({
      _id: data.parentDepartmentId,
      clinicId,
    })
      .select("_id")
      .lean();
    if (!parent) {
      throw new ValidationError("parentDepartmentId not found in this clinic", {
        field: "parentDepartmentId",
      });
    }
  }

  try {
    const dep = await ClinicDepartment.findOneAndUpdate(
      { _id: id, clinicId },
      { $set: data },
      { new: true, runValidators: true }, // runValidators — чтобы enum/maxlength работали на update
    ).lean();
    if (!dep) throw new NotFoundError("Department");
    return dep;
  } catch (e) {
    if (e?.code === 11000) {
      throw new ConflictError("Department code already exists in this clinic", {
        field: "code",
      });
    }
    throw e;
  }
}

// ── SET HEAD (заведующий отделением) ──────────────────────
// headMembershipId = null → снять заведующего.
export async function setDepartmentHead(clinicId, id, headMembershipId) {
  const dep = await ClinicDepartment.findOneAndUpdate(
    { _id: id, clinicId },
    { $set: { headMembershipId: headMembershipId || null } },
    { new: true },
  ).lean();
  if (!dep) throw new NotFoundError("Department");
  return dep;
}

// ── ARCHIVE (soft delete) ─────────────────────────────────
// Не удаляем физически: на отделение могут ссылаться записи/пациенты.
// Системное "General" архивировать нельзя (это fallback-отделение).
export async function archiveDepartment(clinicId, id) {
  const dep = await ClinicDepartment.findOne({ _id: id, clinicId });
  if (!dep) throw new NotFoundError("Department");
  if (dep.isSystem) {
    throw new ConflictError("System department cannot be archived");
  }

  // Обрываем ссылки дочерних отделений на архивируемый родитель.
  await ClinicDepartment.updateMany(
    { clinicId, parentDepartmentId: dep._id },
    { $set: { parentDepartmentId: null } },
  );

  dep.status = "archived";
  await dep.save();
  return dep.toObject();
}

// ── ENSURE "GENERAL" ──────────────────────────────────────
// Вызывать при создании клиники. Идемпотентно.
// Существующие записи прода маршрутизируем сюда (departmentId = id этого отделения).
export async function ensureGeneralDepartment(
  clinicId,
  { name = "General" } = {},
) {
  const existing = await ClinicDepartment.findOne({
    clinicId,
    isSystem: true,
  }).lean();
  if (existing) return existing;

  const dep = await ClinicDepartment.create({
    clinicId,
    name,
    specialty: "general",
    isSystem: true,
  });
  return dep.toObject();
}

// ── CROSS-MODULE GUARD ────────────────────────────────────
// Для appointments / patients / rooms: проверка, что departmentId
// принадлежит этой клинике и не архивирован.
// departmentId опционален (null допустим) — тогда возвращаем null без ошибки.
export async function assertDepartmentInClinic(clinicId, departmentId) {
  if (!departmentId) return null;

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
  return dep._id;
}
