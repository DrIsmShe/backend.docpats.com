// server/modules/clinic/clinic-medical/services/patientSummary.service.js
// ─────────────────────────────────────────────────────────────────────
//   Сводка пациента: один экран вместо двенадцати вкладок.
//
//   ЗАЧЕМ. Данные о пациенте разложены по восьми подмодулям — аллергии,
//   хронические, операции, семейный анамнез, прививки, назначения,
//   анализы, приёмы. Каждый из них устроен как форма для ЗАПОЛНЕНИЯ, и
//   ни один не отвечает на вопрос, с которым врач открывает карту:
//   «что мне про этого человека важно знать прямо сейчас».
//
//   Врач не будет обходить восемь вкладок перед каждым приёмом. Он
//   откроет одну, самую нужную, и пропустит аллергию, лежащую в другой.
//
//   ─── ПОЧЕМУ ЗДЕСЬ НЕТ МОДЕЛИ ───────────────────────────────────────
//
//   Соблазн очевидный: скормить всю карту модели и попросить абзац
//   «главное о пациенте». Так делать НЕЛЬЗЯ, и это не осторожность, а
//   свойство задачи.
//
//   Пересказ — операция с потерями. Модель, пересказывая карту, может
//   пропустить аллергию на пенициллин или назвать не тот препарат, и
//   выглядеть это будет ровно так же убедительно, как правильный ответ.
//   Врач, читающий сводку перед назначением, проверить её не сможет —
//   он для того её и читает, чтобы не читать первоисточник.
//
//   Поэтому сводка собирается ДЕТЕРМИНИРОВАННО: каждая строка здесь —
//   это поле из записи, а не вывод о нём. Ничего не обобщается, ничего
//   не переформулируется. Модель в этом файле не участвует вовсе.
//
//   Место для ИИ в этом экране есть, но другое: объяснить ПАЦИЕНТУ его
//   анализ человеческим языком (см. labExplain) — там ошибка стоит
//   недоразумения, а не назначения.
//
//   ─── ДОСТУП ─────────────────────────────────────────────────────────
//
//   Ни одного собственного запроса к базе: сводка складывается из тех же
//   сервисов, что и обычные списки. Причина простая — доступ к карте
//   пациента в мультиарендной системе решается тремя правилами
//   (владение, точечный доступ, согласие), и переписать их здесь заново
//   означает однажды разойтись с оригиналом и показать чужую карту.
//   Лишние запросы дешевле утечки.
// ─────────────────────────────────────────────────────────────────────

import allergyService from "./allergy.service.js";
import chronicService from "./chronic.service.js";
import operationService from "./operation.service.js";
import familyService from "./family.service.js";
import immunizationService from "./immunization.service.js";
// Назначения и анализы устроены не через subRecordBase — у них своя
// логика (статусы, PDF, тренды), поэтому именованные функции, а не
// сервис-объект.
import { listPrescriptionsForPatient } from "./prescription.service.js";
import { listLabResultsForPatient } from "./labResult.service.js";
import { listEncountersForPatient } from "./medicalHistory.service.js";
import { getLatestIntakeForPatient } from "../../../previsit/services/previsit.service.js";
import { LAB_FLAGS } from "../../../../common/standards/labParameter.schema.js";
import { require as requirePerm } from "../../../../common/auth/can.js";
import { UnprocessableError } from "../../../../common/utils/errors.js";
import logger from "../../../../common/logger.js";

const log = logger.child({ module: "clinic-medical/summary" });

// Сколько последних приёмов показываем. Больше пяти на одном экране
// перестают читаться, а хронология доступна на вкладке приёмов.
const RECENT_ENCOUNTERS = 5;

// Глубина, на которую смотрим анализы для динамики. Два измерения
// достаточно, чтобы сказать «выросло» или «упало»; тренд по десяти
// точкам — это график, а не сводка.
const LAB_PANELS_SCANNED = 12;

// Отклонение — это ЛЮБОЙ флаг, кроме «normal».
//
// Список выводим из схемы, а не переписываем сюда: свой список однажды
// разошёлся бы с ней, и новый флаг молча считался бы нормой. Ошибка
// такого рода не падает и не логируется — она просто не показывает
// врачу отклонение.
const ABNORMAL_FLAGS = new Set(LAB_FLAGS.filter((f) => f !== "normal"));

// Флаги, требующие внимания немедленно. Они попадают в отдельный
// список: разница между «слегка повышен» и «критически повышен» — это
// разница между «учесть» и «звонить пациенту».
const CRITICAL_FLAGS = new Set(["critical_high", "critical_low"]);

/** Безопасный вызов источника: одна недоступная вкладка не должна ронять весь экран. */
async function safely(label, fn) {
  try {
    return await fn();
  } catch (err) {
    // Отказ по правам — законный исход: у роли может не быть доступа к
    // разделу. Пустой раздел честнее, чем ошибка на весь экран.
    log.warn({ section: label, err: err.message }, "Секция сводки недоступна");
    return null;
  }
}

/** Числовое значение показателя или null, если оно качественное. */
function numericValue(param) {
  const n = Number(param?.value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Ключ показателя для сопоставления между разными сдачами.
 *
 * LOINC-код надёжнее названия: «Гемоглобин», «Hb» и «HGB» — один и тот
 * же показатель, и по названию они не совпадут. Название используем
 * только когда кода нет.
 */
function paramKey(param) {
  const loinc = String(param?.loincCode || "").trim();
  if (loinc) return `loinc:${loinc}`;
  return `name:${String(param?.name || "").trim().toLowerCase()}`;
}

/**
 * Динамика показателя между двумя последними сдачами.
 *
 * Возвращает null, если сравнивать не с чем или значения качественные:
 * писать «выросло» про «положительно/отрицательно» бессмысленно.
 */
function trendFor(current, previous) {
  const now = numericValue(current);
  const before = numericValue(previous);
  if (now === null || before === null) return null;
  if (now === before) return { direction: "same", delta: 0, previous: before };

  const delta = now - before;
  // Процент считаем от прошлого значения; деление на ноль отдаёт null,
  // а не Infinity в интерфейсе врача.
  const percent = before !== 0 ? Math.round((delta / before) * 100) : null;

  return {
    direction: delta > 0 ? "up" : "down",
    delta: Math.round(delta * 1000) / 1000,
    percent,
    previous: before,
  };
}

/**
 * Последние значения показателей с динамикой.
 *
 * Идём от свежих панелей к старым и берём КАЖДЫЙ показатель по первому
 * появлению — так последнее значение оказывается актуальным даже если
 * разные показатели сдавались в разные дни.
 */
function collectLabHighlights(panels) {
  const latest = new Map(); // ключ → { param, panel }
  const previous = new Map();

  for (const panel of panels) {
    for (const param of panel.parameters || []) {
      const key = paramKey(param);
      if (!latest.has(key)) {
        latest.set(key, { param, panel });
      } else if (!previous.has(key)) {
        previous.set(key, { param, panel });
      }
    }
  }

  const items = [];
  for (const [key, { param, panel }] of latest) {
    const prev = previous.get(key)?.param || null;
    const flag = param.flag || "normal";

    items.push({
      key,
      name: param.name,
      loincCode: param.loincCode || null,
      value: param.value,
      unit: param.unit || null,
      flag,
      isAbnormal: ABNORMAL_FLAGS.has(flag),
      isCritical: CRITICAL_FLAGS.has(flag),
      referenceRange: param.referenceRange || null,
      measuredAt: panel.effectiveDateTime || panel.createdAt || null,
      panelTitle: panel.panelTitle || panel.panelType || null,
      trend: trendFor(param, prev),
    });
  }

  // Сначала критические, потом остальные отклонения, потом норма.
  // Врач читает сверху и должен упереться в важное, а не искать его.
  const weight = (i) => (i.isCritical ? 0 : i.isAbnormal ? 1 : 2);
  items.sort((a, b) => {
    const w = weight(a) - weight(b);
    if (w !== 0) return w;
    return new Date(b.measuredAt || 0) - new Date(a.measuredAt || 0);
  });

  return items;
}

/**
 * Сводка пациента.
 *
 * @param {object} args
 * @param {object} args.patient — документ пациента (из resolvePatient)
 * @returns {Promise<object>} — секции сводки; каждая может быть пустой
 */
export async function getPatientSummary({ patient }) {
  requirePerm("medical_record", "read");

  if (!patient || !patient._id) {
    throw new UnprocessableError("Patient is required");
  }

  // Параллельно: секции независимы, и последовательный обход восьми
  // источников превратил бы «один экран» в две секунды ожидания.
  const [
    allergies,
    chronic,
    operations,
    family,
    immunization,
    prescriptions,
    labs,
    encounters,
    previsit,
  ] = await Promise.all([
    safely("allergies", () => allergyService.list({ patient, query: { limit: 50 } })),
    safely("chronic", () => chronicService.list({ patient, query: { limit: 50 } })),
    safely("operations", () => operationService.list({ patient, query: { limit: 20 } })),
    safely("family", () => familyService.list({ patient, query: { limit: 20 } })),
    safely("immunization", () =>
      immunizationService.list({ patient, query: { limit: 30 } }),
    ),
    safely("prescriptions", () =>
      listPrescriptionsForPatient({ patient, query: { limit: 30 } }),
    ),
    safely("labs", () =>
      listLabResultsForPatient({
        patient,
        query: { limit: LAB_PANELS_SCANNED },
      }),
    ),
    safely("encounters", () =>
      listEncountersForPatient({
        patient,
        query: { limit: RECENT_ENCOUNTERS },
      }),
    ),
    // Анкета, заполненная пациентом перед приёмом. Ставится в сводку, а
    // не отдельной вкладкой: врач читает сводку до приёма, и рассказ
    // пациента нужен ему именно там. Отдельная вкладка означала бы, что
    // анкету увидит тот, кто про неё знает.
    safely("previsit", () =>
      getLatestIntakeForPatient({ patientId: patient._id }),
    ),
  ]);

  const labPanels = labs?.items || labs || [];
  const labHighlights = collectLabHighlights(
    Array.isArray(labPanels) ? labPanels : [],
  );

  const encounterList = encounters?.items || encounters || [];

  return {
    patientId: String(patient._id),

    // Аллергии идут первыми и отдельным полем, а не в общем списке
    // «особенности»: это единственный раздел карты, незнание которого
    // убивает в течение минут.
    allergies: (allergies?.items || allergies || []).map((a) => ({
      id: a._id,
      content: a.content,
      recordedAt: a.createdAt,
    })),

    chronic: (chronic?.items || chronic || []).map((c) => ({
      id: c._id,
      content: c.content,
      recordedAt: c.createdAt,
    })),

    operations: (operations?.items || operations || []).map((o) => ({
      id: o._id,
      content: o.content,
      recordedAt: o.createdAt,
    })),

    familyHistory: (family?.items || family || []).map((f) => ({
      id: f._id,
      content: f.content,
      recordedAt: f.createdAt,
    })),

    immunization: (immunization?.items || immunization || []).map((i) => ({
      id: i._id,
      content: i.content,
      recordedAt: i.createdAt,
    })),

    // Назначения — что пациент принимает СЕЙЧАС. Без них любое новое
    // назначение делается вслепую по части взаимодействий.
    prescriptions: (prescriptions?.items || prescriptions || []).map((p) => ({
      id: p._id,
      medication: p.medication || p.name || null,
      dosage: p.dosage || null,
      status: p.status || null,
      prescribedAt: p.createdAt,
    })),

    labs: {
      // Отклонения отдельно от всего остального: их читают всегда,
      // норму — когда есть время.
      abnormal: labHighlights.filter((i) => i.isAbnormal),
      all: labHighlights,
      panelsScanned: Array.isArray(labPanels) ? labPanels.length : 0,
    },

    encounters: (Array.isArray(encounterList) ? encounterList : [])
      .slice(0, RECENT_ENCOUNTERS)
      .map((e) => ({
        id: e._id,
        date: e.createdAt,
        diagnosis:
          e.mainDiagnosis?.text || e.mainDiagnosis?.codeTitle || null,
        code: e.mainDiagnosis?.code || null,
        status: e.status,
        signedAt: e.signedAt || null,
      })),

    // Анкета перед приёмом — то, что пациент рассказал о себе сам.
    // null, если её не заполняли: пустой блок в интерфейсе честнее
    // отсутствующего, но выдумывать содержимое нечем.
    previsit: previsit || null,

    generatedAt: new Date().toISOString(),
  };
}

export default { getPatientSummary };
