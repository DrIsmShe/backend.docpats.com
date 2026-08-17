// server/modules/clinic/clinic-medical/services/fhir/fhirMapper.js
// ─────────────────────────────────────────────────────────────────────
//   Карта пациента → FHIR R4.
//
//   ЗАЧЕМ ЭТО ВООБЩЕ. «А мы сможем забрать свои данные?» — вопрос,
//   который клиника задаёт до покупки, а не после. Ответ «выгрузим в
//   Excel» означает «нет»: таблица без структуры не переносится ни в
//   одну другую систему. FHIR — единственный формат, про который
//   спрашивающий знает заранее, что он совместим.
//
//   ЗАПРОСОВ К БАЗЕ ЗДЕСЬ НЕТ И НЕ ДОЛЖНО БЫТЬ. Файл получает готовые
//   записи и превращает их в ресурсы. Чистая функция проверяется
//   таблицей входов и выходов, а конвертер, который сам ходит в базу,
//   проверяется только целиком и поэтому не проверяется никогда.
//
//   ЧТО НЕ ЗАПОЛНЯЕТСЯ ВЫДУМАННЫМ. Поля, которых в наших записях нет
//   (clinicalStatus у аллергии, verificationStatus у диагноза,
//   criticality), оставлены пустыми. FHIR допускает их отсутствие, а
//   подставленное «active» было бы утверждением, которого никто не
//   делал: принимающая система прочтёт его как факт из карты.
//
//   ВЕРСИЯ R4 (4.0.1) — та, которую понимают все, а не самая новая.
// ─────────────────────────────────────────────────────────────────────

/** Системы кодирования. Строки нормативные, менять нельзя. */
export const SYSTEMS = {
  icd10: "http://hl7.org/fhir/sid/icd-10",
  loinc: "http://loinc.org",
  observationCategory:
    "http://terminology.hl7.org/CodeSystem/observation-category",
  // Наши собственные идентификаторы: нужны, чтобы принимающая сторона
  // могла сопоставить повторную выгрузку с прошлой.
  internal: "urn:docpats:id",
};

/** ISO-строка или null. Дату не выдумываем: пустая дата честнее сегодняшней. */
function isoOrNull(d) {
  if (!d) return null;
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Убрать ключи со значением null/undefined/[] — FHIR не любит пустые поля. */
function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      const nested = clean(v);
      if (Object.keys(nested).length === 0) continue;
      out[k] = nested;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** Ссылка на пациента в том виде, в каком её ждёт принимающая система. */
function patientRef(patientId) {
  return { reference: `Patient/${patientId}` };
}

// ─── Ресурсы ──────────────────────────────────────────────────────────

/**
 * Patient.
 *
 * ИМЯ РАСШИФРОВАННОЕ. Выгрузка без имени бесполезна — записи не с кем
 * сопоставить на приёмной стороне. Именно поэтому доступ к выгрузке
 * ограничен строже, чем к отдельным разделам карты.
 */
export function toPatient({ id, firstName, lastName, gender, dateOfBirth, phone, email }) {
  return clean({
    resourceType: "Patient",
    id: String(id),
    identifier: [{ system: SYSTEMS.internal, value: String(id) }],
    name:
      firstName || lastName
        ? [
            clean({
              use: "official",
              family: lastName || null,
              given: firstName ? [firstName] : null,
            }),
          ]
        : null,
    // FHIR знает male/female/other/unknown — наш enum совпадает.
    gender: gender || null,
    birthDate: dateOfBirth
      ? new Date(dateOfBirth).toISOString().slice(0, 10)
      : null,
    telecom: [
      phone ? { system: "phone", value: phone } : null,
      email ? { system: "email", value: email } : null,
    ].filter(Boolean),
  });
}

/**
 * AllergyIntolerance.
 *
 * У нас аллергия — свободный текст («Пенициллин — анафилаксия»),
 * структурного кода вещества нет. Поэтому code.text, без coding:
 * выдуманный код опаснее его отсутствия — принимающая система будет
 * работать с ним как с достоверным.
 */
export function toAllergy(rec, patientId) {
  return clean({
    resourceType: "AllergyIntolerance",
    id: String(rec.id || rec._id),
    patient: patientRef(patientId),
    code: { text: rec.content || null },
    recordedDate: isoOrNull(rec.recordedAt || rec.createdAt),
  });
}

/** Condition — хроническое заболевание. */
export function toCondition(rec, patientId) {
  return clean({
    resourceType: "Condition",
    id: String(rec.id || rec._id),
    subject: patientRef(patientId),
    code: { text: rec.content || null },
    recordedDate: isoOrNull(rec.recordedAt || rec.createdAt),
  });
}

/** Procedure — перенесённая операция. */
export function toProcedure(rec, patientId) {
  return clean({
    resourceType: "Procedure",
    id: String(rec.id || rec._id),
    subject: patientRef(patientId),
    // completed — не догадка: раздел называется «перенесённые операции».
    status: "completed",
    code: { text: rec.content || null },
    performedDateTime: isoOrNull(rec.recordedAt || rec.createdAt),
  });
}

/** Immunization — прививка. */
export function toImmunization(rec, patientId) {
  return clean({
    resourceType: "Immunization",
    id: String(rec.id || rec._id),
    patient: patientRef(patientId),
    status: "completed",
    vaccineCode: { text: rec.content || null },
    occurrenceDateTime: isoOrNull(rec.recordedAt || rec.createdAt),
  });
}

/** FamilyMemberHistory — наследственность. */
export function toFamilyHistory(rec, patientId) {
  return clean({
    resourceType: "FamilyMemberHistory",
    id: String(rec.id || rec._id),
    patient: patientRef(patientId),
    status: "completed",
    // Кем приходится родственник, у нас не структурировано — весь текст
    // в note, а обязательный relationship остаётся без кода.
    relationship: { text: "не указано" },
    note: rec.content ? [{ text: rec.content }] : null,
  });
}

/** MedicationRequest — назначение. */
export function toMedicationRequest(rec, patientId) {
  return clean({
    resourceType: "MedicationRequest",
    id: String(rec.id || rec._id),
    subject: patientRef(patientId),
    // Статус берём из записи; неизвестный не подменяем на active.
    status: rec.status || "unknown",
    intent: "order",
    medicationCodeableConcept: {
      text: rec.medication || rec.name || null,
    },
    authoredOn: isoOrNull(rec.prescribedAt || rec.createdAt),
    dosageInstruction: rec.dosage ? [{ text: rec.dosage }] : null,
  });
}

/**
 * Observation — один показатель анализа.
 *
 * LOINC переносится, когда он есть в записи. Именно ради него выгрузка
 * и имеет смысл: по коду принимающая система поймёт, что «HGB» и
 * «Гемоглобин» — один показатель, а по названию не поймёт.
 */
export function toObservation(param, panel, patientId) {
  const numeric = Number(param.value);
  const hasNumber = Number.isFinite(numeric);

  const range =
    param.referenceRange &&
    (param.referenceRange.min !== null || param.referenceRange.max !== null)
      ? [
          clean({
            low:
              param.referenceRange.min !== null
                ? { value: param.referenceRange.min, unit: param.unit || null }
                : null,
            high:
              param.referenceRange.max !== null
                ? { value: param.referenceRange.max, unit: param.unit || null }
                : null,
          }),
        ]
      : null;

  return clean({
    resourceType: "Observation",
    // Составной идентификатор: у показателя внутри панели своего id нет,
    // а без стабильного идентификатора повторная выгрузка создаст дубли.
    id: `${String(panel._id)}-${param.loincCode || param.name}`
      .replace(/[^A-Za-z0-9.\-]/g, "-")
      .slice(0, 64),
    subject: patientRef(patientId),
    status: panel.status === "preliminary" ? "preliminary" : "final",
    category: [
      {
        coding: [
          {
            system: SYSTEMS.observationCategory,
            code: "laboratory",
          },
        ],
      },
    ],
    code: clean({
      coding: param.loincCode
        ? [{ system: SYSTEMS.loinc, code: param.loincCode, display: param.name }]
        : null,
      text: param.name || null,
    }),
    effectiveDateTime: isoOrNull(panel.effectiveDateTime || panel.createdAt),
    valueQuantity: hasNumber
      ? clean({ value: numeric, unit: param.unit || null })
      : null,
    // Нечисловой результат («отрицательно») — строкой, а не выброшенный.
    valueString: !hasNumber && param.value != null ? String(param.value) : null,
    referenceRange: range,
    // Флаг переносим только если он есть; «normal» по умолчанию не
    // подставляем — это был бы вывод, которого лаборатория не делала.
    interpretation:
      param.flag && param.flag !== "normal"
        ? [{ text: param.flag }]
        : null,
  });
}

/** Encounter — приём. */
export function toEncounter(rec, patientId) {
  const diagnosis = rec.mainDiagnosis || {};
  return clean({
    resourceType: "Encounter",
    id: String(rec.id || rec._id),
    subject: patientRef(patientId),
    status: rec.status === "draft" ? "in-progress" : "finished",
    class: { code: "AMB", display: "ambulatory" },
    period: { start: isoOrNull(rec.date || rec.createdAt) },
    reasonCode: diagnosis.code || diagnosis.text
      ? [
          clean({
            coding: diagnosis.code
              ? [
                  {
                    system: SYSTEMS.icd10,
                    code: diagnosis.code,
                    display: diagnosis.codeTitle || null,
                  },
                ]
              : null,
            text: diagnosis.text || diagnosis.codeTitle || null,
          }),
        ]
      : null,
  });
}

/**
 * Собрать Bundle.
 *
 * Тип collection, а не document: document требует Composition —
 * подписанный документ с автором и датой подписи, то есть утверждение
 * «вот выписка, я за неё отвечаю». Выгрузка такого утверждения не
 * делает, она просто отдаёт записи.
 */
export function buildBundle({ baseUrl, resources }) {
  return {
    resourceType: "Bundle",
    type: "collection",
    timestamp: new Date().toISOString(),
    total: resources.length,
    entry: resources.map((r) => ({
      fullUrl: `${baseUrl}/${r.resourceType}/${r.id}`,
      resource: r,
    })),
  };
}

export default {
  SYSTEMS,
  toPatient,
  toAllergy,
  toCondition,
  toProcedure,
  toImmunization,
  toFamilyHistory,
  toMedicationRequest,
  toObservation,
  toEncounter,
  buildBundle,
};
