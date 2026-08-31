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
  TEMPLATE_SCOPES,
  kindsForScope,
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
    // Записи, заведённые до появления заготовок приёма, поля scope не имеют —
    // отдаём им область по умолчанию, чтобы интерфейс не встретил undefined.
    scope: doc.scope || "examination",
    modality: doc.modality || null,
    kind: doc.kind,
    title: doc.title,
    body: doc.body || "",
    createdBy: doc.createdBy ? String(doc.createdBy) : null,
    createdByEmployee: doc.createdByEmployee ? String(doc.createdByEmployee) : null,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

/**
 * Проверить область, вид исследования и блок до обращения к базе.
 *
 * Блок проверяется ПРОТИВ ОБЛАСТИ, а не против общего перечня: иначе
 * заготовку «жалобы» можно было бы завести для протокола КТ, и она вылезла
 * бы в форме исследования, где ей не место.
 */
function validate({ scope = "examination", modality, kind }) {
  if (!TEMPLATE_SCOPES.includes(scope)) {
    throw new UnprocessableError(
      `scope должен быть одним из: ${TEMPLATE_SCOPES.join(", ")}`,
    );
  }

  // Вид исследования нужен только протоколам: у жалоб и анамнеза его нет.
  if (scope !== "encounter") {
    if (!modality || !VALID_STUDY_TYPES.includes(modality)) {
      throw new UnprocessableError(
        `modality обязателен и должен быть одним из: ${VALID_STUDY_TYPES.join(", ")}`,
      );
    }
  }

  const allowed = kindsForScope(scope);
  if (!kind || !allowed.includes(kind)) {
    throw new UnprocessableError(
      `kind для области «${scope}» должен быть одним из: ${allowed.join(", ")}`,
    );
  }
}

// ─── СПИСОК ────────────────────────────────────────────────────────────
//
// Основной сценарий: форма исследования открывает список заготовок нужного
// вида, чтобы врач выбрал готовую формулировку.
export async function listTemplates({
  scope = "examination",
  modality,
  kind,
  limit = 200,
} = {}) {
  requirePerm("examination_template", "read");
  requireClinicId();

  const filter = {};

  // Область отбирается всегда, даже если её не передали: без этого форма
  // исследования увидела бы заготовки жалоб, а форма приёма — протоколы КТ.
  // Записи, заведённые до появления поля, считаются протоколами.
  filter.scope =
    scope === "encounter" ? "encounter" : { $in: ["examination", null] };

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
  if (!title) throw new UnprocessableError("title обязателен", { i18n: "app.validation.titleRequired" });

  const actorType = getCurrentActorType();
  const userId = getCurrentUserId();

  const scope = body.scope === "encounter" ? "encounter" : "examination";

  const doc = new ExaminationTemplate({
    clinicId,
    scope,
    // У заготовки приёма вида исследования нет — пишем null, а не пустую
    // строку: по null поле не попадает в отбор по модальности.
    modality: scope === "encounter" ? null : body.modality,
    kind: body.kind,
    title,
    body: String(body.body || ""),
    // Сотрудник клиники и врач-пользователь — разные личности; заполняем ту,
    // которой соответствует текущий актор.
    createdBy: actorType === "employee" ? null : userId,
    createdByEmployee: actorType === "employee" ? userId : null,
  });

  await doc.save();
  log.info(
    { clinicId: String(clinicId), scope, modality: doc.modality, kind: body.kind },
    "создана заготовка",
  );

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
    if (!title) throw new UnprocessableError("title не может быть пустым", { i18n: "app.validation.titleEmpty" });
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
