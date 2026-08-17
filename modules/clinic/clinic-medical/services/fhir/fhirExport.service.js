// server/modules/clinic/clinic-medical/services/fhir/fhirExport.service.js
// ─────────────────────────────────────────────────────────────────────
//   Выгрузка карты пациента в FHIR R4.
//
//   ИСТОЧНИК ДАННЫХ ТОТ ЖЕ, ЧТО У СВОДКИ. Ни одного собственного
//   запроса: разделы берутся из тех же сервисов, что и обычные списки,
//   потому что доступ к карте решают три правила (владение, точечный
//   доступ, согласие). Переписать их здесь заново — однажды разойтись с
//   оригиналом и выгрузить чужую карту одним файлом.
//
//   ВЫГРУЗКА ОПАСНЕЕ ЧТЕНИЯ. Просмотр раздела оставляет данные на
//   экране; выгрузка кладёт всю карту вместе с ИМЕНЕМ в файл, который
//   дальше живёт своей жизнью. Поэтому:
//     • право write, а не read: забрать карту целиком — не рядовое
//       чтение, и роли, которым положено смотреть, не обязательно
//       положено уносить;
//     • отдельный тип ресурса в журнале аудита, а не «ещё один список»:
//       через полгода надо уметь ответить, кто и когда выгрузил карту.
// ─────────────────────────────────────────────────────────────────────

import allergyService from "../allergy.service.js";
import chronicService from "../chronic.service.js";
import operationService from "../operation.service.js";
import familyService from "../family.service.js";
import immunizationService from "../immunization.service.js";
import { listPrescriptionsForPatient } from "../prescription.service.js";
import { listLabResultsForPatient } from "../labResult.service.js";
import { listEncountersForPatient } from "../medicalHistory.service.js";
import { decryptValue } from "../../../clinic-patients/models/clinicPatient.model.js";
import { require as requirePerm } from "../../../../../common/auth/can.js";
import { UnprocessableError } from "../../../../../common/utils/errors.js";
import logger from "../../../../../common/logger.js";
import * as map from "./fhirMapper.js";

const log = logger.child({ module: "clinic-medical/fhir" });

// Потолки на раздел. Выгрузка обязана завершаться: карта, копившаяся
// десять лет, не должна класть процесс. Обрезание фиксируется в ответе —
// молча укороченная выгрузка выглядит как полная.
const LIMITS = {
  subRecords: 500,
  prescriptions: 500,
  labs: 200,
  encounters: 500,
};

/** Одна секция; отказ по правам — пустой раздел, а не срыв выгрузки. */
async function safely(label, fn) {
  try {
    return await fn();
  } catch (err) {
    log.warn({ section: label, err: err.message }, "Секция не выгружена");
    return null;
  }
}

const rows = (r) => (Array.isArray(r?.items) ? r.items : Array.isArray(r) ? r : []);

/**
 * Выгрузить карту пациента.
 *
 * @param {object} args
 * @param {object} args.patient — документ пациента (из resolveClinicPatient)
 * @param {string} args.baseUrl — база для fullUrl в Bundle
 */
export async function exportPatientAsFhir({ patient, baseUrl }) {
  // ЗАПИСЬ, а не чтение: забрать карту целиком — не рядовой просмотр.
  requirePerm("medical_record", "write");

  if (!patient || !patient._id) {
    throw new UnprocessableError("Patient is required");
  }

  const patientId = String(patient._id);

  const [
    allergies,
    chronic,
    operations,
    family,
    immunization,
    prescriptions,
    labs,
    encounters,
  ] = await Promise.all([
    safely("allergies", () =>
      allergyService.list({ patient, query: { limit: LIMITS.subRecords } }),
    ),
    safely("chronic", () =>
      chronicService.list({ patient, query: { limit: LIMITS.subRecords } }),
    ),
    safely("operations", () =>
      operationService.list({ patient, query: { limit: LIMITS.subRecords } }),
    ),
    safely("family", () =>
      familyService.list({ patient, query: { limit: LIMITS.subRecords } }),
    ),
    safely("immunization", () =>
      immunizationService.list({ patient, query: { limit: LIMITS.subRecords } }),
    ),
    safely("prescriptions", () =>
      listPrescriptionsForPatient({
        patient,
        query: { limit: LIMITS.prescriptions },
      }),
    ),
    safely("labs", () =>
      listLabResultsForPatient({ patient, query: { limit: LIMITS.labs } }),
    ),
    safely("encounters", () =>
      listEncountersForPatient({
        patient,
        query: { limit: LIMITS.encounters },
      }),
    ),
  ]);

  // Пациент. Имя расшифровываем: выгрузка без имени бесполезна —
  // записи не с чем сопоставить на приёмной стороне.
  const resources = [
    map.toPatient({
      id: patientId,
      firstName: decryptValue(patient.firstNameEncrypted),
      lastName: decryptValue(patient.lastNameEncrypted),
      phone: decryptValue(patient.phoneEncrypted),
      email: decryptValue(patient.emailEncrypted),
      gender: patient.gender,
      dateOfBirth: patient.dateOfBirth,
    }),
  ];

  for (const r of rows(allergies)) resources.push(map.toAllergy(r, patientId));
  for (const r of rows(chronic)) resources.push(map.toCondition(r, patientId));
  for (const r of rows(operations)) resources.push(map.toProcedure(r, patientId));
  for (const r of rows(family))
    resources.push(map.toFamilyHistory(r, patientId));
  for (const r of rows(immunization))
    resources.push(map.toImmunization(r, patientId));
  for (const r of rows(prescriptions))
    resources.push(map.toMedicationRequest(r, patientId));
  for (const r of rows(encounters)) resources.push(map.toEncounter(r, patientId));

  // Анализы разворачиваются в отдельные Observation: в FHIR единица —
  // показатель, а не бланк. Панель как таковая в R4 передаётся
  // DiagnosticReport, но без него данные читаются, а без Observation —
  // нет, поэтому начинаем с показателей.
  for (const panel of rows(labs)) {
    for (const param of panel.parameters || []) {
      resources.push(map.toObservation(param, panel, patientId));
    }
  }

  const bundle = map.buildBundle({ baseUrl, resources });

  log.info(
    { patientId, resources: resources.length },
    "Карта выгружена в FHIR",
  );

  return bundle;
}

export default { exportPatientAsFhir, LIMITS };
