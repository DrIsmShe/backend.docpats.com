// server/modules/radiology/ai/caseReviser.js
//
// ТРЕТИЙ ПРОХОД: РЕДАКТОР. Правит черновик кейса по замечаниям рецензента.
//
// Первый проход придумывает кейс (caseGenerator), второй его рецензирует
// (caseVerifier) и НИЧЕГО не правит — там это принципиально: рецензент,
// который переписывает, становится вторым слоем выдумывания без следов.
// Правку делает отдельный вызов — этот, — и разделение сохраняется: редактор
// видит замечания и данные, но не рассуждения рецензента, а его работу потом
// заново рецензирует четвёртый вызов (ai/autoFix.js гоняет цикл).
//
// ЧТО ЭТО НЕ РЕШАЕТ. Редактор и рецензент — одна модель. Согласованность
// данных цикл вычищает хорошо (ради неё он и сделан), но «правдоподобный, но
// неверный референсный интервал», который обе стороны считают правильным,
// после любого числа кругов останется на месте. Поэтому «замечаний нет» здесь
// означает «внутренних противоречий не осталось», а не «кейс верен», и
// последним читателем всё равно остаётся врач.
//
// Редактору РАЗРЕШЕНО не согласиться с замечанием: модель ошибается и в
// рецензии тоже, а покорная правка верного значения на неверное — худший
// исход, чем оставленное замечание. Несогласие идёт в disputed с обоснованием
// и показывается автору отдельным списком.
//
// Состав и порядок панели редактор менять не должен без прямого указания
// замечания: на позиции завязано сопоставление с ключами показателей при
// сохранении (см. applyLabAiRevision в labs-station/lab.service.js), а на
// ключи — эталон, варианты и разборы уже сданных попыток.

import { findingsForModality } from "../lexicon/lexicon.js";
import { DIFFICULTIES, SIGNIFICANCES } from "../constants.js";
import { ValidationError } from "../../../common/utils/errors.js";
import { runJson, isConfigured, str, list } from "./aiRunner.js";

export { isConfigured };

const difficultyOf = (v) => (DIFFICULTIES.includes(v) ? v : "medium");

// Отчёт о работе редактора. Он нужен не для красоты: правка, которую нельзя
// прочитать одной строкой, для автора неотличима от «модель переписала кейс
// целиком», и доверия к результату не прибавляет.
const REPORT_FIELDS = {
  changes: {
    type: "array",
    description:
      "Что именно изменено — по одной записи на правку. Пустой массив, если ничего менять не потребовалось.",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["target", "change", "why"],
      properties: {
        target: {
          type: "string",
          description:
            "Что правил: точное название показателя/обследования либо impression, context, title, findings, case.",
        },
        change: {
          type: "string",
          description: "Было → стало, коротко и конкретно.",
        },
        why: {
          type: "string",
          description: "На какое замечание это отвечает и почему правка именно такая.",
        },
      },
    },
  },
  disputed: {
    type: "array",
    description:
      "Замечания, которые ты считаешь НЕВЕРНЫМИ и потому не исправлял. Пустой массив, если таких нет. Не отправляй сюда замечание только потому, что править его трудоёмко.",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["issue", "why"],
      properties: {
        issue: {
          type: "string",
          description: "Замечание рецензента, с которым ты не согласен, — своими словами, кратко.",
        },
        why: {
          type: "string",
          description: "Почему исходные данные верны, а замечание — нет. Со ссылкой на цифры кейса.",
        },
      },
    },
  },
};

const COMMON_RULES = `Ты — врач-эксперт и редактор учебных кейсов медицинского тренажёра. Тебе дан ЧЕРНОВИК кейса и замечания рецензента. Твоя задача — выпустить ИСПРАВЛЕННУЮ версию кейса, внутренне согласованную и пригодную к публикации.

Как править:
1. Исправляй по существу замечаний И всё, что от этих правок разъехалось. Правка одного показателя часто требует правки текста заключения — сделай и её, иначе кейс станет противоречивее, чем был.
2. НЕ ПЕРЕПИСЫВАЙ то, к чему замечаний нет. Стиль, формулировки, порядок изложения не трогай: тебя читают по диффу, и шум в нём означает, что правки никто не проверит.
3. Не меняй состав и порядок пунктов данных (показателей/обследований) и их названия, если замечание не требует именно этого. На порядок завязано сопоставление с сохранённым кейсом.
4. Диагноз менять можно только тогда, когда замечание говорит, что он не выводится из данных. Обычный путь — привести данные в соответствие с диагнозом, а не наоборот.
5. Если замечание НЕВЕРНО — не выполняй его. Оставь данные как есть и объясни в disputed. Молча проигнорировать замечание нельзя: несогласие должно быть видно.
6. Не добавляй в кейс данные реального пациента, ФИО, даты и идентификаторы. Кейс вымышленный и учебный.
7. Верни кейс ЦЕЛИКОМ, включая неизменённые части, — ответ заменяет черновик полностью.

Пиши по-русски, профессиональным медицинским языком. Ответ верни строго в заданной JSON-структуре.`;

// Замечания отдаём нумерованным списком с их severity: редактор должен
// понимать, какое из них рецензент считает блокирующим, но решение о правке
// принимает по существу, а не по метке.
function issuesText(issues) {
  const rows = (Array.isArray(issues) ? issues : [])
    .filter((i) => str(i?.issue, 1500))
    .slice(0, 30)
    .map((i, n) => {
      const head = `${n + 1}. [${i.severity === "error" ? "ошибка" : "внимание"}]${
        i.target ? ` ${i.target}:` : ""
      }`;
      const body = str(i.issue, 1500);
      const fix = str(i.suggestion, 1500);
      return `${head} ${body}${fix ? `\n   Предложение рецензента: ${fix}` : ""}`;
    });
  if (!rows.length) throw new ValidationError("Нет замечаний для исправления");
  return rows.join("\n");
}

function asJson(value) {
  return JSON.stringify(value, null, 2).slice(0, 60000);
}

// УКАЗАНИЕ АВТОРА. Рецензент часто предлагает два пути («убрать упоминание
// ГГТП либо добавить показатель в панель»), и выбор между ними — врачебный, а
// не редакторский: один сохраняет учебную ценность кейса, другой её убивает.
// Без этого поля автор мог только принять то, что выбрала модель, и переделать
// руками.
//
// Указание идёт ПОСЛЕ замечаний и объявлено главнее: если автор говорит
// «добавь ГГТП», спорить с ним редактор не должен — это не рецензия, это
// решение владельца кейса.
function hintBlock(hint) {
  const clean = str(hint, 1000);
  return clean
    ? `\n\nУКАЗАНИЕ АВТОРА (важнее предложений рецензента — если они расходятся, делай так, как сказал автор):\n${clean}`
    : "";
}

// Отчёт нормализуем так же, как остальной вывод модели: длины ограничены,
// пустые записи отброшены.
function normalizeReport(parsed) {
  return {
    changes: (Array.isArray(parsed.changes) ? parsed.changes : [])
      .map((c) => ({
        target: str(c?.target, 160),
        change: str(c?.change, 1000),
        why: str(c?.why, 1000),
      }))
      .filter((c) => c.change)
      .slice(0, 40),
    disputed: (Array.isArray(parsed.disputed) ? parsed.disputed : [])
      .map((d) => ({ issue: str(d?.issue, 1000), why: str(d?.why, 1500) }))
      .filter((d) => d.issue && d.why)
      .slice(0, 30),
  };
}

// ─── Станция «Анализы» ─────────────────────────────────────────────────

const LAB_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "clinicalContext", "difficulty", "panel", "impression", "changes", "disputed"],
  properties: {
    title: { type: "string", description: "Название кейса — без изменений, если к нему нет замечаний." },
    clinicalContext: {
      type: "string",
      description: "Клинический контекст, видимый учащемуся, с внесёнными правками.",
    },
    difficulty: { type: "string", enum: DIFFICULTIES, description: "Сложность кейса." },
    panel: {
      type: "array",
      description:
        "Панель результатов ЦЕЛИКОМ, в исходном порядке: и исправленные показатели, и оставленные без изменений.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "value", "unit", "refRange", "significant"],
        properties: {
          name: { type: "string", description: "Название показателя." },
          value: { type: "string", description: "Значение строкой." },
          unit: { type: "string", description: "Единицы измерения; пустая строка, если их нет." },
          refRange: { type: "string", description: "Референсный интервал; пустая строка, если неприменим." },
          significant: {
            type: "boolean",
            description:
              "true — клинически значимое отклонение, которое учащийся обязан отметить. Не всякое отклонение от референса значимо.",
          },
        },
      },
    },
    impression: {
      type: "object",
      additionalProperties: false,
      required: ["correctText", "diagnosisKeys", "diagnosisSynonyms"],
      properties: {
        correctText: { type: "string", description: "Эталонная интерпретация панели с учётом правок." },
        diagnosisKeys: {
          type: "array",
          description: "Принятые термины диагноза простыми словами.",
          items: { type: "string" },
        },
        diagnosisSynonyms: {
          type: "array",
          description: "Синонимы диагноза для оценки свободного текста.",
          items: { type: "string" },
        },
      },
    },
    ...REPORT_FIELDS,
  },
};

/**
 * Исправить кейс станции «Анализы» по замечаниям рецензента.
 * @param {object} args.draft   черновик (title, clinicalContext, panel, impression)
 * @param {object[]} args.issues замечания из caseVerifier
 */
export async function reviseLabCase({ draft, issues, hint = "" }) {
  if (!draft || !Array.isArray(draft.panel) || draft.panel.length < 2) {
    throw new ValidationError("Нет кейса для исправления");
  }

  const { parsed, usage, model } = await runJson({
    system: `${COMMON_RULES}

Кейс станции «Анализы»: учащийся видит клинический контекст и панель результатов, отмечает значимо отклонённые показатели и ставит диагноз. Поле significant — это эталон: показатель, который учащийся ОБЯЗАН отметить.

Особое внимание при правке:
- показатели одного обмена должны согласовываться между собой и с клинической картиной;
- значение вне референса, но клинически незначимое, significant НЕ помечается;
- клинически значимое отклонение обязано быть помечено significant;
- единицы и референсные интервалы — реальные, для взрослого пациента.`,
    instruction: `Замечания рецензента:\n${issuesText(issues)}\n\nЧерновик кейса:\n\n${asJson({
      title: draft.title,
      clinicalContext: draft.clinicalContext,
      difficulty: draft.difficulty,
      panel: draft.panel,
      impression: draft.impression,
    })}${hintBlock(hint)}\n\nВыпусти исправленную версию кейса целиком.`,
    schema: LAB_SCHEMA,
    what: "кейс",
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

  // Пустая или обрезанная панель — это не «кейс стал короче», а потеря данных
  // автора. Лучше вернуть ошибку и оставить исходный кейс нетронутым.
  if (panel.length < 2) {
    throw new ValidationError("Редактор вернул слишком короткую панель — правки не применены");
  }

  return {
    draft: {
      title: str(parsed.title, 300) || str(draft.title, 300),
      clinicalContext: str(parsed.clinicalContext, 4000),
      difficulty: difficultyOf(parsed.difficulty ?? draft.difficulty),
      panel,
      impression: {
        correctText: str(parsed.impression?.correctText, 4000),
        diagnosisKeys: list(parsed.impression?.diagnosisKeys, 20, 120),
        diagnosisSynonyms: list(parsed.impression?.diagnosisSynonyms, 50, 120),
      },
    },
    ...normalizeReport(parsed),
    model,
    usage,
  };
}

// ─── Станция «Виртуальный пациент» ─────────────────────────────────────

const VP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "presentation",
    "difficulty",
    "investigations",
    "diagnosis",
    "changes",
    "disputed",
  ],
  properties: {
    title: { type: "string", description: "Название сценария." },
    presentation: { type: "string", description: "Жалоба и вводная с учётом правок." },
    difficulty: { type: "string", enum: DIFFICULTIES, description: "Сложность сценария." },
    investigations: {
      type: "array",
      description: "Список обследований ЦЕЛИКОМ, в исходном порядке.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "category", "resultText", "necessary"],
        properties: {
          name: { type: "string", description: "Название обследования." },
          category: { type: "string", description: "Категория обследования." },
          resultText: { type: "string", description: "Результат, раскрываемый при назначении." },
          necessary: {
            type: "boolean",
            description: "true — обследование входит в разумный минимум.",
          },
        },
      },
    },
    diagnosis: {
      type: "object",
      additionalProperties: false,
      required: ["correctText", "diagnosisKeys", "diagnosisSynonyms"],
      properties: {
        correctText: { type: "string", description: "Верный диагноз и логика вывода с учётом правок." },
        diagnosisKeys: { type: "array", items: { type: "string" } },
        diagnosisSynonyms: { type: "array", items: { type: "string" } },
      },
    },
    ...REPORT_FIELDS,
  },
};

/**
 * Исправить сценарий «Виртуальный пациент» по замечаниям рецензента.
 */
export async function reviseVpCase({ draft, issues, hint = "" }) {
  if (!draft || !Array.isArray(draft.investigations) || draft.investigations.length < 2) {
    throw new ValidationError("Нет сценария для исправления");
  }

  const { parsed, usage, model } = await runJson({
    system: `${COMMON_RULES}

Сценарий «Виртуальный пациент»: игрок видит жалобу, сам выбирает обследования из списка и ставит диагноз. Поле necessary — эталон: обследование входит в разумный минимум.

Особое внимание при правке:
- necessary стоит у обследований, без которых диагноз не поставить, и НЕ стоит у избыточных;
- у ненужных обследований результат — правдоподобная норма, а не намёк на другой диагноз;
- набор necessary обязан позволять прийти к диагнозу.`,
    instruction: `Замечания рецензента:\n${issuesText(issues)}\n\nЧерновик сценария:\n\n${asJson({
      title: draft.title,
      presentation: draft.presentation,
      difficulty: draft.difficulty,
      investigations: draft.investigations,
      diagnosis: draft.diagnosis,
    })}${hintBlock(hint)}\n\nВыпусти исправленную версию сценария целиком.`,
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
    throw new ValidationError("Редактор вернул меньше двух обследований — правки не применены");
  }

  return {
    draft: {
      title: str(parsed.title, 300) || str(draft.title, 300),
      presentation: str(parsed.presentation, 4000),
      difficulty: difficultyOf(parsed.difficulty ?? draft.difficulty),
      investigations,
      diagnosis: {
        correctText: str(parsed.diagnosis?.correctText, 4000),
        diagnosisKeys: list(parsed.diagnosis?.diagnosisKeys, 20, 120),
        diagnosisSynonyms: list(parsed.diagnosis?.diagnosisSynonyms, 50, 120),
      },
    },
    ...normalizeReport(parsed),
    model,
    usage,
  };
}

// ─── Лучевой кейс (текстовая часть и план находок) ─────────────────────
//
// Разметку на кадре редактор не трогает и трогать не может: точки ставит
// человек, который видел снимок. Правится текст и план находок — то, что
// ночная генерация и создаёт.

const RADIOLOGY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "clinicalContext",
    "difficulty",
    "plannedFindings",
    "impression",
    "changes",
    "disputed",
  ],
  properties: {
    title: { type: "string", description: "Название кейса." },
    clinicalContext: { type: "string", description: "Клинический контекст с учётом правок." },
    difficulty: { type: "string", enum: DIFFICULTIES, description: "Сложность кейса." },
    plannedFindings: {
      type: "array",
      description:
        "План находок ЦЕЛИКОМ, в исходном порядке. Коды — строго из списка допустимых, данного в инструкции.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "significance", "location", "explanation"],
        properties: {
          label: { type: "string", description: "Код находки строго из списка допустимых." },
          significance: { type: "string", enum: SIGNIFICANCES, description: "Значимость находки." },
          location: { type: "string", description: "Где искать находку на снимке, словами." },
          explanation: { type: "string", description: "Почему это патология — 1–2 предложения." },
        },
      },
    },
    impression: {
      type: "object",
      additionalProperties: false,
      required: ["correctText", "diagnosisKeys", "diagnosisSynonyms"],
      properties: {
        correctText: { type: "string", description: "Эталонное заключение с учётом правок." },
        diagnosisKeys: { type: "array", items: { type: "string" } },
        diagnosisSynonyms: { type: "array", items: { type: "string" } },
      },
    },
    ...REPORT_FIELDS,
  },
};

/**
 * Исправить лучевой кейс по замечаниям рецензента.
 *
 * Снимок сюда НЕ передаётся намеренно: замечания к соответствию кадра тексту
 * («на снимке этой находки не видно») правкой текста не лечатся — их решает
 * человек, меняя снимок или разметку. Редактор чинит текстовую часть.
 */
export async function reviseRadiologyCase({ draft, issues, modality, hint = "" }) {
  if (!draft || !Array.isArray(draft.plannedFindings)) {
    throw new ValidationError("Нет кейса для исправления");
  }
  if (!modality) throw new ValidationError("Не выбрана модальность");

  const allowed = findingsForModality(modality);
  const known = new Set(allowed.map((t) => t.key));
  const labelList = allowed.map((t) => `- ${t.key}: ${t.label}`).join("\n");

  const { parsed, usage, model } = await runJson({
    system: `${COMMON_RULES}

Лучевой кейс: учащийся ищет находки на снимке и пишет заключение. Снимок правишь не ты — ты правишь текстовую часть и план находок: что на кадре должно быть, где искать и как звучит эталонное заключение.

Особое внимание при правке:
- находка должна быть в принципе видима на данной модальности;
- набор находок соответствует диагнозу и клиническому контексту;
- значимость (critical/major/incidental) соответствует реальной опасности пропуска;
- заключение не упоминает находок, которых нет в плане;
- коды находок бери СТРОГО из списка допустимых, выдумывать новые нельзя.

Если замечание касается СНИМКА (находки не видно на кадре, не та модальность, не та сторона) — исправить это текстом нельзя: отправь такое замечание в disputed с пояснением, что решение принимает автор, меняя снимок или разметку.`,
    instruction: `Модальность исследования: ${modality}.\n\nЗамечания рецензента:\n${issuesText(
      issues,
    )}\n\nДопустимые коды находок:\n${labelList}\n\nЧерновик кейса:\n\n${asJson({
      title: draft.title,
      clinicalContext: draft.clinicalContext,
      difficulty: draft.difficulty,
      plannedFindings: draft.plannedFindings,
      impression: draft.impression,
    })}${hintBlock(hint)}\n\nВыпусти исправленную версию кейса целиком.`,
    schema: RADIOLOGY_SCHEMA,
    what: "кейс",
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
    draft: {
      title: str(parsed.title, 300) || str(draft.title, 300),
      clinicalContext: str(parsed.clinicalContext, 4000),
      difficulty: difficultyOf(parsed.difficulty ?? draft.difficulty),
      plannedFindings,
      impression: {
        correctText: str(parsed.impression?.correctText, 4000),
        diagnosisKeys: list(parsed.impression?.diagnosisKeys, 20, 120),
        diagnosisSynonyms: list(parsed.impression?.diagnosisSynonyms, 50, 120),
      },
    },
    ...normalizeReport(parsed),
    model,
    usage,
  };
}
