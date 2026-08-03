// modules/clinic/clinic-medical/services/examinationTemplate.service.js
//
// Справочник заготовок для протоколов исследований.
//
// ЧЕМ ЭТОТ СЕРВИС ПРОЩЕ ОСТАЛЬНЫХ В МОДУЛЕ. Здесь нет ни пациента, ни
// согласий, ни межклиничного доступа: заготовка — обезличенная формулировка,
// принадлежащая клинике. Поэтому нет и цепочки ownership → sharedWith →
// consent, обязательной для медицинских записей. Изоляцию целиком берёт на
// себя плагин tenantScoped на модели: он подставляет clinicId в каждый
// запрос из контекста и роняет обращение, у которого явный clinicId
// контексту противоречит.
//
// Права проверяются отдельным ресурсом examination_template — заводить
// формулировки может не всякий, кому позволено читать карту пациента.

import ExaminationTemplate, {
  TEMPLATE_KINDS,
} from "../models/examinationTemplate.model.js";
import {
  NotFoundError,
  ForbiddenError,
  UnprocessableError,
} from "../../../../common/utils/errors.js";
import {
  getCurrentClinicId,
  getCurrentUserId,
  getCurrentActorType,
} from "../../../../common/context/tenantContext.js";
import { require as requirePerm } from "../../../../common/auth/can.js";
import { VALID_STUDY_TYPES } from "./imaging.service.js";
import logger from "../../../../common/logger.js";

const log = logger.child({ module: "clinic-medical/examinationTemplate.service" });

function requireClinicId() {
  const clinicId = getCurrentClinicId();
  if (!clinicId) throw new ForbiddenError("No active clinic context");
  return clinicId;
}

function toShape(doc) {
  if (!doc) return null;
  return {
    _id: String(doc._id),
    modality: doc.modality,
    kind: doc.kind,
    title: doc.title,
    body: doc.body || "",
    createdBy: doc.createdBy ? String(doc.createdBy) : null,
    createdByEmployee: doc.createdByEmployee ? String(doc.createdByEmployee) : null,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

/** Проверить вид исследования и вид заготовки до обращения к базе. */
function validate({ modality, kind }) {
  if (!modality || !VALID_STUDY_TYPES.includes(modality)) {
    throw new UnprocessableError(
      `modality обязателен и должен быть одним из: ${VALID_STUDY_TYPES.join(", ")}`,
    );
  }
  if (!kind || !TEMPLATE_KINDS.includes(kind)) {
    throw new UnprocessableError(
      `kind обязателен и должен быть одним из: ${TEMPLATE_KINDS.join(", ")}`,
    );
  }
}

// ─── СПИСОК ────────────────────────────────────────────────────────────
//
// Основной сценарий: форма исследования открывает список заготовок нужного
// вида, чтобы врач выбрал готовую формулировку.
export async function listTemplates({ modality, kind, limit = 200 } = {}) {
  requirePerm("examination_template", "read");
  requireClinicId();

  const filter = {};
  if (modality) filter.modality = modality;
  if (kind) filter.kind = kind;

  const rows = Math.min(Math.max(Number.parseInt(limit, 10) || 200, 1), 500);

  // clinicId в фильтр не добавляем — его подставит плагин из контекста.
  const docs = await ExaminationTemplate.find(filter)
    .sort({ createdAt: -1 })
    .limit(rows)
    .lean();

  return { items: docs.map(toShape), count: docs.length };
}

// ─── ОДНА ЗАГОТОВКА ────────────────────────────────────────────────────
export async function getTemplate(templateId) {
  requirePerm("examination_template", "read");
  requireClinicId();

  const doc = await ExaminationTemplate.findById(templateId).lean();
  // Чужая заготовка приходит как null (плагин отфильтровал по клинике) —
  // отвечаем «не найдено», а не «нет доступа»: так наличие чужой записи не
  // подтверждается перебором идентификаторов.
  if (!doc) throw new NotFoundError("ExaminationTemplate");

  return toShape(doc);
}

// ─── СОЗДАНИЕ ──────────────────────────────────────────────────────────
export async function createTemplate(body = {}) {
  requirePerm("examination_template", "write");
  const clinicId = requireClinicId();

  validate(body);

  const title = String(body.title || "").trim();
  if (!title) throw new UnprocessableError("title обязателен");

  const actorType = getCurrentActorType();
  const userId = getCurrentUserId();

  const doc = new ExaminationTemplate({
    clinicId,
    modality: body.modality,
    kind: body.kind,
    title,
    body: String(body.body || ""),
    // Сотрудник клиники и врач-пользователь — разные личности; заполняем ту,
    // которой соответствует текущий актор.
    createdBy: actorType === "employee" ? null : userId,
    createdByEmployee: actorType === "employee" ? userId : null,
  });

  await doc.save();
  log.info({ clinicId: String(clinicId), modality: body.modality, kind: body.kind },
    "создана заготовка протокола");

  return toShape(doc);
}

// ─── ПРАВКА ────────────────────────────────────────────────────────────
export async function updateTemplate(templateId, body = {}) {
  requirePerm("examination_template", "write");
  requireClinicId();

  const doc = await ExaminationTemplate.findById(templateId);
  if (!doc) throw new NotFoundError("ExaminationTemplate");

  if (Object.prototype.hasOwnProperty.call(body, "title")) {
    const title = String(body.title || "").trim();
    if (!title) throw new UnprocessableError("title не может быть пустым");
    doc.title = title;
  }
  if (Object.prototype.hasOwnProperty.call(body, "body")) {
    doc.body = String(body.body || "");
  }
  // modality и kind не меняем: заготовка «заключение для КТ», ставшая
  // «названием для МРТ», — это другая запись, а не правка существующей.

  await doc.save();
  return toShape(doc);
}

// ─── УДАЛЕНИЕ ──────────────────────────────────────────────────────────
//
// Полное, без мягкого удаления: в справочнике формулировок нет истории,
// которую надо сохранять, а на уже сохранённые исследования удаление не
// влияет — текст туда скопирован, а не связан ссылкой.
export async function deleteTemplate(templateId) {
  requirePerm("examination_template", "delete");
  requireClinicId();

  const doc = await ExaminationTemplate.findById(templateId);
  if (!doc) throw new NotFoundError("ExaminationTemplate");

  await ExaminationTemplate.deleteOne({ _id: doc._id });
  return { deleted: true, _id: String(doc._id) };
}
