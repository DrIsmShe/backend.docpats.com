// server/modules/procedures/validators/procedure.validator.js
//
// Разбор и нормализация тела запроса. Отдельно от контроллера, потому что
// «что вообще может прийти снаружи» — это отдельный вопрос от «что с этим
// делать», и проверять его хочется тестом без базы и без сессии.
//
// Здесь нет проверок, требующих обращения к БД: занятость времени, права и
// существование пациента — дело сервиса.

import {
  PROCEDURE_KINDS,
  PROCEDURE_STATUSES,
} from "../../../common/models/Procedure/procedureBooking.js";
import { ProcedureError } from "../services/procedure.service.js";

const ANESTHESIA = ["none", "local", "sedation", "regional", "general"];
const PATIENT_KINDS = ["registered", "private", "new"];

function str(v, { max, field }) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > max) {
    throw new ProcedureError(`Поле «${field}» длиннее ${max} символов`);
  }
  return s;
}

export function validateCreate(body) {
  const kind = String(body.kind || "").trim();
  if (!PROCEDURE_KINDS.includes(kind)) {
    throw new ProcedureError(
      "Укажите вид: операция (surgery) или обследование (examination)",
    );
  }

  const title = str(body.title, { max: 300, field: "название" });
  if (!title) {
    throw new ProcedureError("Укажите название вмешательства", { i18n: "app.procedure.titleRequired" });
  }

  // Время: либо готовый инстант, либо наивное локальное «YYYY-MM-DDTHH:MM».
  // Ни одного — отказ; собирать инстант из «сегодня» опасно молча.
  if (!body.startsAt && !body.startsAtLocal) {
    throw new ProcedureError("Укажите дату и время начала", { i18n: "app.procedure.startRequired" });
  }

  const durationMin = Number(body.durationMin);
  if (!Number.isFinite(durationMin)) {
    throw new ProcedureError("Укажите длительность в минутах", { i18n: "app.procedure.durationMinutesRequired" });
  }

  const anesthesia = body.anesthesia
    ? String(body.anesthesia).trim()
    : "none";
  if (!ANESTHESIA.includes(anesthesia)) {
    throw new ProcedureError("Некорректный вид анестезии", { i18n: "app.procedure.invalidAnesthesia" });
  }

  const patient = body.patient || {};
  if (!PATIENT_KINDS.includes(String(patient.kind || ""))) {
    throw new ProcedureError("Не указан тип пациента", { i18n: "app.procedure.patientTypeMissing" });
  }

  return {
    kind,
    title,
    code: str(body.code, { max: 40, field: "код" }),
    startsAt: body.startsAt,
    startsAtLocal: body.startsAtLocal,
    durationMin,
    place: str(body.place, { max: 300, field: "место" }),
    preparation: str(body.preparation, { max: 2000, field: "подготовка" }),
    fasting: Boolean(body.fasting),
    anesthesia,
    notesDoctor: str(body.notesDoctor, { max: 2000, field: "примечание" }),
    patient,
  };
}

export function validateStatus(body) {
  const status = String(body.status || "").trim();
  if (!PROCEDURE_STATUSES.includes(status)) {
    throw new ProcedureError("Некорректный статус", { i18n: "app.procedure.invalidStatus" });
  }
  // postponed ставится только переносом: у него обязан появиться адресат
  // (новая запись), иначе в базе повисает «перенесено в никуда».
  if (status === "postponed") {
    throw new ProcedureError(
      "Перенос оформляется отдельным запросом, а не сменой статуса",
      { code: "USE_POSTPONE" },
    );
  }
  return {
    status,
    cancelReason: str(body.cancelReason, { max: 500, field: "причина" }),
  };
}

export function validatePostpone(body) {
  if (!body.startsAt && !body.startsAtLocal) {
    throw new ProcedureError("Укажите новую дату и время", { i18n: "app.procedure.newDateTimeRequired" });
  }
  const durationMin =
    body.durationMin === undefined ? null : Number(body.durationMin);
  if (durationMin !== null && !Number.isFinite(durationMin)) {
    throw new ProcedureError("Некорректная длительность", { i18n: "app.procedure.invalidDuration" });
  }
  return {
    startsAt: body.startsAt,
    startsAtLocal: body.startsAtLocal,
    durationMin,
    reason: str(body.reason, { max: 500, field: "причина" }),
  };
}
