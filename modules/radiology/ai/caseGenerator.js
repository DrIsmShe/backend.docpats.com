// server/modules/radiology/ai/caseGenerator.js
//
// Генерация УЧЕБНОГО КЕЙСА ЦЕЛИКОМ по теме — для всех трёх станций арены:
// лучевая диагностика (/admin/radiology), «Анализы» (/admin/labs) и
// «Виртуальный пациент» (/admin/vp).
//
// Отличие от ai/aiDrafter.js: тот разбирает УЖЕ ЗАГРУЖЕННЫЙ снимок (vision) и
// отдаёт черновик по картинке. Здесь снимка нет вообще: автор задаёт тему
// («ЖДА у молодой женщины», «пневмоторакс»), а модель придумывает весь кейс —
// контекст, данные (панель анализов / список обследований / ожидаемые находки),
// эталонное заключение и ключи диагноза.
//
// Философия та же: это ЧЕРНОВИК для эксперта. Ничего не публикуется
// автоматически — форма заполняется на клиенте, автор правит и сохраняет, а
// публикация лучевого кейса всё равно проходит гейт ревью. Источник таких
// кейсов честно помечается source.kind = "ai_generated" (см. constants.js).
//
// Вызов модели, обработка ошибок API и нормализаторы — в ai/aiRunner.js:
// тем же путём ходит верификатор кейса (ai/caseVerifier.js).

import { findingsForModality } from "../lexicon/lexicon.js";
import {
  ValidationError,
  ServiceUnavailableError,
} from "../../../common/utils/errors.js";
import { DIFFICULTIES, SIGNIFICANCES } from "../constants.js";
import { runJson, isConfigured, str, list } from "./aiRunner.js";

// Реэкспорт: контроллеры спрашивают «настроен ли ИИ» у генератора.
export { isConfigured };

const difficultyOf = (v) => (DIFFICULTIES.includes(v) ? v : "medium");

// Общий блок «эталон»: заключение + принятые ключи диагноза.
const impressionSchema = (correctDescription) => ({
  type: "object",
  additionalProperties: false,
  required: ["correctText", "diagnosisKeys", "diagnosisSynonyms"],
  properties: {
    correctText: { type: "string", description: correctDescription },
    diagnosisKeys: {
      type: "array",
      description:
        "Принятые термины диагноза простыми словами — учащийся вводит диагноз текстом. Напр.: 'жда', 'железодефицитная анемия'.",
      items: { type: "string" },
    },
    diagnosisSynonyms: {
      type: "array",
      description: "Синонимы диагноза для оценки свободного текста.",
      items: { type: "string" },
    },
  },
});

const difficultyField = {
  type: "string",
  enum: DIFFICULTIES,
  description: "Сложность кейса для учащегося.",
};

// Общие правила для всех трёх станций. Кейс УЧЕБНЫЙ и вымышленный — это
// принципиально: платформа HIPAA-ориентированная, данные реального пациента
// в учебный контент попадать не должны.
const COMMON_RULES = `Жёсткие правила:
1. Кейс ВЫМЫШЛЕННЫЙ и учебный. Не используй данные реальных пациентов, не выдумывай ФИО, даты, номера карт и другие идентификаторы.
2. Клиника, лабораторные значения и находки должны быть внутренне СОГЛАСОВАНЫ: по совокупности данных диагноз должен выводиться однозначно.
3. Значения показателей — правдоподобные, с реальными единицами и референсными интервалами взрослого пациента.
4. Пиши по-русски, профессиональным медицинским языком, без воды.
5. Диагноз в diagnosisKeys — простыми словами, как его напишет учащийся; добавь и латиницу/англ. термин, если он в ходу.
6. Это ЧЕРНОВИК: его проверит и поправит врач-эксперт. Не отказывайся помогать с учебным материалом.

Ответ верни строго в заданной JSON-структуре.`;

// ─── Станция «Анализы» ─────────────────────────────────────────────────

const LAB_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "clinicalContext", "difficulty", "panel", "impression"],
  properties: {
    title: {
      type: "string",
      description: "Краткое учебное название кейса (без диагноза в открытом виде, если он должен быть загадкой).",
    },
    clinicalContext: {
      type: "string",
      description:
        "Клинический контекст, видимый учащемуся ДО ответа: возраст, пол, жалобы, анамнез, значимые данные осмотра.",
    },
    difficulty: difficultyField,
    panel: {
      type: "array",
      description:
        "Панель лабораторных результатов, которую видит учащийся: 6–14 показателей. Часть — в норме (отвлекающие), часть — значимо отклонена.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "value", "unit", "refRange", "significant"],
        properties: {
          name: { type: "string", description: "Название показателя, напр. 'Гемоглобин'." },
          value: {
            type: "string",
            description:
              "Значение строкой: число ('92') либо качественный результат ('положительный', 'следы').",
          },
          unit: { type: "string", description: "Единицы измерения; пустая строка, если их нет." },
          refRange: {
            type: "string",
            description: "Референсный интервал, напр. '120–150'. Пустая строка, если неприменим.",
          },
          significant: {
            type: "boolean",
            description:
              "true — это КЛИНИЧЕСКИ ЗНАЧИМОЕ отклонение, которое учащийся обязан отметить. Не всякое отклонение от референса значимо.",
          },
        },
      },
    },
    impression: impressionSchema(
      "Образцовая интерпретация панели: какие отклонения ключевые, как они складываются в диагноз, что дообследовать.",
    ),
  },
};

const LAB_SYSTEM = `Ты — врач клинической лабораторной диагностики и преподаватель. Ты составляешь УЧЕБНЫЙ кейс для станции «Анализы» диагностической арены: учащийся видит клинический контекст и панель результатов, отмечает значимо отклонённые показатели и ставит диагноз.

${COMMON_RULES}`;

/**
 * Полностью сгенерированный кейс станции «Анализы».
 * @param {object} args
 * @param {string} args.topic       тема/задание от автора («ЖДА у молодой женщины»)
 * @param {string} [args.difficulty] желаемая сложность (подсказка модели)
 * @param {string} [args.hint]      дополнительные пожелания автора
 */
export async function generateLabCase({ topic, difficulty, hint }) {
  const cleanTopic = str(topic, 500);
  if (!cleanTopic) throw new ValidationError("Укажите тему кейса для ИИ");

  const instruction = [
    `Тема кейса: ${cleanTopic}.`,
    difficulty ? `Желаемая сложность: ${difficultyOf(difficulty)}.` : null,
    hint ? `Пожелания автора: ${str(hint, 1000)}` : null,
    "Составь полный учебный кейс станции «Анализы» по этой теме.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const { parsed, usage } = await runJson({
    system: LAB_SYSTEM,
    instruction,
    schema: LAB_SCHEMA,
  });

  const panel = (Array.isArray(parsed.panel) ? parsed.panel : [])
    .filter((p) => str(p?.name, 120) && str(p?.value, 60))
    .slice(0, 40)
    .map((p) => ({
      name: str(p.name, 120),
      value: str(p.value, 60),
      unit: str(p.unit, 40),
      refRange: str(p.refRange, 60),
      significant: Boolean(p.significant),
    }));

  if (panel.length < 2) {
    throw new ServiceUnavailableError(
      "ИИ вернул слишком короткую панель показателей — попробуйте уточнить тему",
    );
  }

  return {
    title: str(parsed.title, 300),
    clinicalContext: str(parsed.clinicalContext, 4000),
    difficulty: difficultyOf(parsed.difficulty),
    panel,
    impression: {
      correctText: str(parsed.impression?.correctText, 4000),
      diagnosisKeys: list(parsed.impression?.diagnosisKeys, 20, 120),
      diagnosisSynonyms: list(parsed.impression?.diagnosisSynonyms, 50, 120),
    },
    usage,
  };
}

// ─── Станция «Виртуальный пациент» ─────────────────────────────────────

const VP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "presentation", "difficulty", "investigations", "diagnosis"],
  properties: {
    title: { type: "string", description: "Краткое учебное название сценария." },
    presentation: {
      type: "string",
      description:
        "Жалоба и вводная, которые игрок видит сразу: возраст, пол, повод обращения, анамнез, ключевые данные осмотра.",
    },
    difficulty: difficultyField,
    investigations: {
      type: "array",
      description:
        "Доступные обследования (6–12). Обязательно смешай нужные и лишние: игрок учится ВЫБИРАТЬ, а не назначать всё подряд. Каждое — с готовым результатом.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "category", "resultText", "necessary"],
        properties: {
          name: { type: "string", description: "Название обследования, напр. 'Рентген ОГК в прямой проекции'." },
          category: {
            type: "string",
            description: "Категория: «Осмотр», «Лаборатория», «Лучевая», «Функциональная» и т. п.",
          },
          resultText: {
            type: "string",
            description:
              "Результат, который раскрывается при назначении: конкретные цифры или описание картины. Для лишних обследований — правдоподобная норма.",
          },
          necessary: {
            type: "boolean",
            description:
              "true — обследование входит в разумный минимум, который игрок должен был назначить.",
          },
        },
      },
    },
    diagnosis: impressionSchema(
      "Верный диагноз и логика: какие данные на него указывают, что отвергает альтернативы, какова дальнейшая тактика.",
    ),
  },
};

const VP_SYSTEM = `Ты — опытный клиницист и преподаватель. Ты составляешь УЧЕБНЫЙ сценарий режима «Виртуальный пациент»: игрок видит жалобу, САМ заказывает обследования из списка и ставит диагноз. Кейс должен учить не только читать результаты, но и решать, какое обследование назначить.

${COMMON_RULES}
7. Среди обследований обязательно должны быть и ненужные (с нормальным результатом) — иначе выбирать нечего.`;

/**
 * Полностью сгенерированный кейс «Виртуального пациента».
 * @param {object} args
 * @param {string} args.topic
 * @param {string} [args.difficulty]
 * @param {string} [args.hint]
 */
export async function generateVpCase({ topic, difficulty, hint }) {
  const cleanTopic = str(topic, 500);
  if (!cleanTopic) throw new ValidationError("Укажите тему кейса для ИИ");

  const instruction = [
    `Тема сценария: ${cleanTopic}.`,
    difficulty ? `Желаемая сложность: ${difficultyOf(difficulty)}.` : null,
    hint ? `Пожелания автора: ${str(hint, 1000)}` : null,
    "Составь полный учебный сценарий «Виртуальный пациент» по этой теме.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const { parsed, usage } = await runJson({
    system: VP_SYSTEM,
    instruction,
    schema: VP_SCHEMA,
    what: "сценарий",
  });

  const investigations = (Array.isArray(parsed.investigations) ? parsed.investigations : [])
    .filter((i) => str(i?.name, 160))
    .slice(0, 30)
    .map((i) => ({
      name: str(i.name, 160),
      category: str(i.category, 60),
      resultText: str(i.resultText, 4000),
      necessary: Boolean(i.necessary),
    }));

  if (investigations.length < 2) {
    throw new ServiceUnavailableError(
      "ИИ вернул меньше двух обследований — попробуйте уточнить тему",
    );
  }

  return {
    title: str(parsed.title, 300),
    presentation: str(parsed.presentation, 4000),
    difficulty: difficultyOf(parsed.difficulty),
    investigations,
    diagnosis: {
      correctText: str(parsed.diagnosis?.correctText, 4000),
      diagnosisKeys: list(parsed.diagnosis?.diagnosisKeys, 20, 120),
      diagnosisSynonyms: list(parsed.diagnosis?.diagnosisSynonyms, 50, 120),
    },
    usage,
  };
}

// ─── Лучевой кейс по теме (без снимка) ─────────────────────────────────
//
// Здесь ИИ НЕ ставит точки на кадре: снимка ещё нет, а выдуманные координаты
// были бы ложным эталоном. Модель отдаёт «план разметки» — какие находки
// должны быть на снимке, с их значимостью и пояснением. Автор загружает
// анонимный снимок и расставляет эти находки на холсте одним кликом
// (в UI — кнопка «разметить» у каждой предложенной находки).

const RADIOLOGY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "clinicalContext", "difficulty", "plannedFindings", "impression"],
  properties: {
    title: { type: "string", description: "Краткое учебное название кейса." },
    clinicalContext: {
      type: "string",
      description:
        "Клинический контекст, видимый учащемуся ДО ответа: возраст, пол, жалобы, анамнез, повод к исследованию.",
    },
    difficulty: difficultyField,
    plannedFindings: {
      type: "array",
      description:
        "Находки, которые ДОЛЖНЫ быть видны на снимке этого кейса. Коды — строго из списка допустимых, данного в инструкции. Находку с кодом не из списка не включай.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "significance", "location", "explanation"],
        properties: {
          label: { type: "string", description: "Код находки строго из списка допустимых." },
          significance: {
            type: "string",
            enum: SIGNIFICANCES,
            description:
              "critical — жизнеугрожающее, major — клинически значимое, incidental — случайная малозначимая находка.",
          },
          location: {
            type: "string",
            description:
              "Где искать находку на снимке словами: «правый верхний отдел», «базально слева». Точку на кадре поставит автор.",
          },
          explanation: {
            type: "string",
            description: "Почему это патология — 1–2 предложения для разбора после сдачи.",
          },
        },
      },
    },
    impression: impressionSchema(
      "Образцовое заключение по такому исследованию — как в протоколе описания.",
    ),
  },
};

const RADIOLOGY_SYSTEM = `Ты — врач-рентгенолог и преподаватель. Ты составляешь УЧЕБНЫЙ кейс лучевой диагностики по заданной теме. Снимка у тебя нет: ты описываешь, КАКИМ он должен быть — какие находки на нём обязаны присутствовать, где их искать и как звучит эталонное заключение. Точную разметку на кадре сделает автор.

${COMMON_RULES}
7. Коды находок бери СТРОГО из списка допустимых для этой модальности. Если подходящего кода нет — не выдумывай его, опиши находку только в заключении.`;

/**
 * Полностью сгенерированный лучевой кейс по теме (снимок автор добавит сам).
 * @param {object} args
 * @param {string} args.modality    модальность (определяет словарь находок)
 * @param {string} args.topic
 * @param {string} [args.difficulty]
 * @param {string} [args.hint]
 */
export async function generateRadiologyCase({ modality, topic, difficulty, hint }) {
  const cleanTopic = str(topic, 500);
  if (!cleanTopic) throw new ValidationError("Укажите тему кейса для ИИ");
  if (!modality) throw new ValidationError("Не выбрана модальность");

  const allowed = findingsForModality(modality);
  const known = new Set(allowed.map((t) => t.key));
  const labelList = allowed.map((t) => `- ${t.key}: ${t.label}`).join("\n");

  const instruction = [
    `Модальность исследования: ${modality}.`,
    `Тема кейса: ${cleanTopic}.`,
    difficulty ? `Желаемая сложность: ${difficultyOf(difficulty)}.` : null,
    hint ? `Пожелания автора: ${str(hint, 1000)}` : null,
    `Допустимые коды находок:\n${labelList}`,
    "Составь полный учебный кейс лучевой диагностики по этой теме.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const { parsed, usage } = await runJson({
    system: RADIOLOGY_SYSTEM,
    instruction,
    schema: RADIOLOGY_SCHEMA,
  });

  const plannedFindings = (Array.isArray(parsed.plannedFindings) ? parsed.plannedFindings : [])
    .filter((f) => known.has(f?.label))
    .slice(0, 20)
    .map((f) => ({
      label: f.label,
      significance: SIGNIFICANCES.includes(f.significance) ? f.significance : "major",
      location: str(f.location, 300),
      explanation: str(f.explanation, 2000),
    }));

  return {
    title: str(parsed.title, 300),
    clinicalContext: str(parsed.clinicalContext, 4000),
    difficulty: difficultyOf(parsed.difficulty),
    plannedFindings,
    impression: {
      correctText: str(parsed.impression?.correctText, 4000),
      diagnosisKeys: list(parsed.impression?.diagnosisKeys, 20, 120),
      diagnosisSynonyms: list(parsed.impression?.diagnosisSynonyms, 50, 120),
    },
    usage,
  };
}
