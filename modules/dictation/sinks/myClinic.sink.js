// server/modules/dictation/sinks/myClinic.sink.js
//
// Приёмник для модуля myClinic: черновик осмотра → запись истории болезни.
//
// ЭТО ЕДИНСТВЕННЫЙ ФАЙЛ ДВИЖКА, КОТОРЫЙ ЗНАЕТ ПРО myClinic. Всё остальное —
// приём аудио, распознавание, сборка структуры, воркер, ретеншн — про
// модуль-получатель не знает ничего. Когда дойдёт очередь до модуля clinic,
// добавится второй такой файл, а не переписывание.
//
// ПОЧЕМУ status: "draft", А НЕ "signed". Существующий контроллер
// addPatientsPolyclinicMedicalHistoryController пишет сразу "signed" —
// старая семантика «сохранил, значит подписал», и в нём же стоит пометка,
// что черновики появятся во второй фазе. Это она и есть: машина состояний
// draft/preliminary/signed/amended у модели УЖЕ есть, и черновик обходится
// без mainDiagnosis и без подписи. Врач подписывает сам, обычным путём.
//
// НИЧЕГО НЕ ДОДУМЫВАЕМ И ЗДЕСЬ. null из черновика превращается в отсутствие
// поля, а не в пустую строку: «поле не заполнено» и «врач написал пустоту» —
// разные вещи, и первая честнее.

import newPatientMedicalHistoryModel from "../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";

export const SINK_KEY = "myClinic";

// Поля черновика, которые ложатся в карту один в один. Совпадение имён —
// не случайность: схема разбора писалась под эту модель, чтобы между ними
// не было места для ошибки маппинга.
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
 * Создаёт ЧЕРНОВИК истории болезни из собранной структуры.
 *
 * @param {object} args
 * @param {object} args.draft   результат структурирования (поля или null)
 * @param {object} args.job     задание надиктовки (кто, о ком)
 * @returns {Promise<object>} созданный документ
 */
export async function attach({ draft, job }) {
  const payload = {
    // Пациент: те же три поля, что требует модель. Берутся из задания, а
    // не из запроса — задание фиксировало их в момент загрузки аудио.
    patientType: job.patientType,
    patientTypeModel: job.patientTypeModel,
    patientRef: job.patientRef,

    // Авторство. У модели ровно один создатель: врач-фрилансер myClinic —
    // это createdBy (User). Поля клиники остаются пустыми.
    createdBy: job.doctorId,
    createdByEmployee: null,
    createdByClinicId: null,
    doctorId: job.doctorId,

    // Черновик. Диагноз и подпись здесь не обязательны — это и позволяет
    // отдать врачу незаконченную запись, не ломая валидацию модели.
    status: "draft",
  };

  for (const field of DIRECT_FIELDS) {
    const value = draft?.[field];
    if (value != null && String(value).trim()) payload[field] = String(value).trim();
  }

  // Диагноз — вложенный объект.
  //
  // codeTitle берётся ТОЛЬКО из справочника МКБ (modules/medicalCodes подставил
  // его в черновик по названному коду) и никогда из речи врача: записать туда
  // формулировку диагноза значило бы выдать её за официальное название кода.
  // Пока справочника в проекте не было, поле оставалось пустым — это было
  // сознательное «лучше пусто, чем неверно», а не недоделка.
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

  // Поле diagnosis НЕ заполняем: это legacy-зеркало mainDiagnosis.text,
  // которое синхронизирует pre-save хук модели. Ручное заполнение создало бы
  // расхождение между зеркалом и оригиналом.

  const doc = await newPatientMedicalHistoryModel.create(payload);
  return doc;
}

export default { key: SINK_KEY, attach };
