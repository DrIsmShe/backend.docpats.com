// server/modules/dictation/sinks/clinic.sink.js
//
// Приёмник для модуля clinic: черновик осмотра → запись в карте клиники.
//
// Второй файл движка, знающий про модуль-получатель. Всё остальное —
// приём аудио, распознавание, сборка структуры, воркер, ретеншн — про
// клинику по-прежнему не знает ничего. Ради этого разделение и делалось.
//
// ─── ЧЕМ ОТЛИЧАЕТСЯ ОТ myClinic И ПОЧЕМУ ЭТО ВАЖНО ───────────────────
//
// У врача-фрилансера запись принадлежит ему одному: createdBy = он,
// клиники нет. В клинике же у записи ДВА обязательных признака —
// createdByClinicId и автор, причём автор бывает двух родов: User
// (врач платформы) или ClinicEmployee (внутренний сотрудник). Модель
// требует ровно одного из двух, и перепутать их нельзя: по этим полям
// потом решается доступ и строится аудит.
//
// clinicId берётся ИЗ ЗАДАНИЯ, а не из контекста запроса. Причина в
// том, что приёмник вызывает воркер — вне запроса, где AsyncLocalStorage
// пуст. Взять клинику «из текущего контекста» здесь означало бы взять
// null и создать запись без арендатора: она стала бы невидимой для
// клиники, но осталась в базе.

import newPatientMedicalHistoryModel from "../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";

export const SINK_KEY = "clinic";

// Те же поля, что у myClinic: схема разбора писалась под эту модель.
const DIRECT_FIELDS = [
  "complaints",
  "anamnesisMorbi",
  "anamnesisVitae",
  "statusPreasens",
  "statusLocalis",
  "recommendations",
  "ctScanResults",
  "mriResults",
  "ultrasoundResults",
  "laboratoryTestResults",
];

/**
 * Создаёт ЧЕРНОВИК записи в карте клиники.
 *
 * @param {object} args
 * @param {object} args.draft — результат структурирования
 * @param {object} args.job   — задание надиктовки
 */
export async function attach({ draft, job }) {
  if (!job.clinicId) {
    // Без клиники запись окажется вне всякой аренды: формально
    // существующей, но не видимой никому. Отказ громче тихой потери.
    throw new Error(
      "clinic.sink: у задания нет clinicId — запись создать некуда",
    );
  }

  const payload = {
    patientType: job.patientType,
    patientTypeModel: job.patientTypeModel,
    patientRef: job.patientRef,

    createdByClinicId: job.clinicId,
    // Ровно один из двух — этого требует модель. Сотрудник клиники не
    // является User платформы, и записать его в createdBy значило бы
    // сослаться на несуществующего пользователя.
    createdBy: job.actorType === "employee" ? null : job.doctorId,
    createdByEmployee: job.actorType === "employee" ? job.doctorId : null,
    doctorId: job.actorType === "employee" ? null : job.doctorId,

    status: "draft",
  };

  for (const field of DIRECT_FIELDS) {
    const value = draft?.[field];
    if (value != null && String(value).trim()) payload[field] = String(value).trim();
  }

  const text = draft?.mainDiagnosisText;
  const code = draft?.mainDiagnosisCode;
  const codeTitle = draft?.mainDiagnosisCodeTitle;
  if ((text && String(text).trim()) || (code && String(code).trim())) {
    payload.mainDiagnosis = {
      code: code ? String(code).trim() : "",
      codeTitle: codeTitle ? String(codeTitle).trim() : "",
      text: text ? String(text).trim() : "",
    };
  }

  // Запись создаём в обход арендного плагина осознанно: контекста здесь
  // нет (воркер), а клиника уже проставлена явным полем выше. Плагин в
  // этом случае пропустил бы запрос с предупреждением, но полагаться на
  // побочное поведение хуже, чем сказать прямо.
  const doc = new newPatientMedicalHistoryModel(payload);
  await doc.save({ skipTenantScope: true });
  return doc;
}

export default { key: SINK_KEY, attach };
