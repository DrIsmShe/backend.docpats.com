// server/modules/diagnostics/ai/analyzers.js
//
// АНАЛИЗАТОРЫ — то, чем подмодуль-модальность разбирает материал. Их три, и
// этого достаточно на все десять модальностей:
//
//   report   — разбор текста заключения по протоколу модальности
//              (КТ, МРТ, УЗИ, рентген, ЭКГ, эндоскопия, гистология, кожа);
//   labs     — лабораторная панель: сначала правила (labRules), потом модель;
//   clinical — клинический случай целиком: дифференциальный ряд и что дообследовать.
//
// Общий контракт: analyzer.run({ caseDoc, artifacts, modality, lang }) →
//   { summary, findings[], dataGaps[], usage, promptVersion, model }
// Никакой записи в базу внутри: этим занимается analysis.service. Анализатор —
// чистая функция от входа, поэтому его легко проверить и подменить.
//
// Общая для всех рамка поведения (SYSTEM_BASE) — самое важное в файле.
// Формулировки выбраны так, чтобы модель не выдавала диагноз как утверждение,
// имела право сказать «не знаю» и не додумывала числа.

import { analyzePanel } from "../labs/labRules.js";
import { FINDINGS_SCHEMA, normalizeFindings } from "./findings.schema.js";
// MODEL здесь не нужен: модель для происхождения вывода берётся из ответа
// (при срабатывании fallbacks отвечает не та, которую просили).
import { EFFORT, PROMPT_VERSION, runJson, str } from "./runner.js";
import { languageRule } from "./language.js";

const SYSTEM_BASE = [
  "Ты помогаешь врачу разбирать клинический материал.",
  "Ты НЕ ставишь диагноз и не назначаешь лечение: ты указываешь, на что обратить внимание,",
  "что уточнить и чего в данных не хватает. Итоговое решение принимает врач.",
  "",
  "Правила:",
  "1. Опирайся только на предоставленные данные. Не додумывай значения, даты и факты.",
  "2. Если данных мало — так и скажи в dataGaps и снизь confidence. Отказ лучше догадки.",
  "3. Критическим (critical) помечай только угрозу жизни или органу в ближайшие часы,",
  "   требующую действия у постели больного. Неполнота описания критической не бывает.",
  "4. Каждый вывод должен быть проверяемым: в detail укажи, из чего именно он следует.",
  "5. Не пересказывай весь материал — пиши только то, что меняет тактику.",
  // Язык ответа подставляется по языку врача — см. systemFor ниже.
  "6. __LANGUAGE_RULE__",
  "",
  // Разделение каналов — главное правило этого промпта.
  //
  // findings и dataGaps — разные вещи, и врач читает их по-разному. Пока это
  // не было сказано прямо, модель складывала в findings и версии по пациенту,
  // и замечания о полноте описания. В списке из десяти пунктов три оказывались
  // не про больного, а про то, что автор мало написал, — причём один из них
  // с пометкой «критично». Врачу у постели это мешает: главное тонет.
  "7. findings — только утверждения О ПАЦИЕНТЕ И МАТЕРИАЛЕ: версии, риски,",
  "   несоответствия, что предпринять. Чего не хватает В ОПИСАНИИ — это НЕ вывод:",
  "   такое место только в dataGaps. Не дублируй одно и то же в обоих полях.",
  "",
  // Порядок. Широкий дифференциальный ряд полезен, но без ранжирования он
  // превращается в перечень, по которому непонятно, с чего начинать.
  "8. Порядок findings — по убыванию того, насколько это меняет ближайшие",
  "   действия. Первым — самая вероятная из опасных версий, а не самая редкая.",
  "   Широкий ряд оставь, но расставь его по важности, а не по алфавиту.",
  "",
  // Правило 7 само по себе не ловит «объём обследования не соответствует
  // тяжести» — модель считает это наблюдением о случае, и формально она права.
  // Но такой пункт не несёт ни одного действия, которого нет в соседних, и в
  // списке работает как шум. Проверка «есть ли что сделать» отсекает его, не
  // трогая настоящие выводы: у клинической версии действие есть всегда.
  "9. У каждого вывода должно быть хотя бы одно конкретное действие в",
  "   recommendations. Нечего предложить — значит это не вывод, а пробел:",
  "   такому место в dataGaps, а не в findings.",
  "",
  // summary — ответ на вопрос врача, и он показывается ОТДЕЛЬНО от списка,
  // перед ним. Врач спрашивает «какой диагноз», а получает дифференциальный
  // ряд; ведущая версия должна быть названа словами, а не выводиться из
  // порядка пунктов.
  "10. summary — прямой ответ врачу: что это, скорее всего, и чего нельзя",
  "    пропустить. Назови ведущую версию словами. Это не пересказ материала",
  "    и не список — две-три фразы, которые врач прочитает первыми.",
  "",
  // Врач спрашивает «диагноз?» — ответ должен стоять первым, а не третьим.
  // Раньше порядок задавала сортировка по важности, и ответ переезжал с
  // первого места на третье от прогона к прогону: стоило модели пометить
  // don't-miss версию как critical, и она обгоняла ведущую. Обе оценки
  // законны, но на один и тот же вопрос врач получал разный первый пункт.
  "11. ПЕРВЫМ в findings ставь ведущую версию — прямой ответ на вопрос врача,",
  "    ту же, что названа в summary. Сразу за ней — опасные версии, которые",
  "    нельзя пропустить, даже если их вероятность ниже. Дальше — остальное.",
].join("\n");

/**
 * Рамка поведения под язык врача.
 *
 * Меняется ровно одно правило — язык ОТВЕТА. Сами инструкции остаются
 * русскими: они выверены по формулировкам, и пять их независимых переводов
 * разъезжались бы при каждой правке.
 */
export function systemFor(lang) {
  return SYSTEM_BASE.replace("__LANGUAGE_RULE__", languageRule(lang));
}

/** Клиническая шапка дела — одинаковая для всех анализаторов. */
function caseHeader(caseDoc) {
  const p = caseDoc.patient ?? {};
  const who = [
    p.ageYears ? `${p.ageYears} лет` : null,
    p.sex === "male" ? "мужчина" : p.sex === "female" ? "женщина" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return [
    who ? `Пациент: ${who}.` : null,
    caseDoc.question ? `Вопрос врача: ${str(caseDoc.question, 1000)}` : null,
    caseDoc.clinicalContext
      ? `Клинический контекст: ${str(caseDoc.clinicalContext, 4000)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Тексты артефактов, подписанные видом материала. */
function artifactTexts(artifacts, limit = 12000) {
  return artifacts
    .map((a) => {
      const text = str(a.text, limit);
      if (!text) return null;
      const kind = a.kind === "report" ? "Заключение" : a.kind === "text" ? "Запись врача" : a.kind;
      return `--- ${kind}${a.modality ? ` (${a.modality})` : ""} ---\n${text}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function protocolBlock(modality) {
  return [
    "Протокол разбора этой модальности (проверь каждый пункт):",
    ...(modality.checklist ?? []).map((c, i) => `${i + 1}. ${c}`),
    "",
    "Красные флаги — если что-то из этого есть, вывод об этом должен быть первым и critical:",
    ...(modality.redFlags ?? []).map((r) => `- ${r}`),
  ].join("\n");
}

/* ─── report: текст заключения по протоколу модальности ───────────────── */
export const reportAnalyzer = {
  key: "report",
  async run({ caseDoc, artifacts, modality, lang }) {
    const texts = artifactTexts(artifacts);
    if (!texts) {
      return {
        skipped: true,
        reason: "нет текстовых материалов для разбора",
      };
    }

    const instruction = [
      `Модальность: ${modality.title}.`,
      caseHeader(caseDoc),
      "",
      protocolBlock(modality),
      "",
      "МАТЕРИАЛ:",
      texts,
      "",
      "Разбери материал по протоколу. Отдельно отметь, если заключение не следует",
      "из описания или если описание неполное — это частая и дорогая ошибка.",
    ]
      .filter(Boolean)
      .join("\n");

    const { parsed, usage, model } = await runJson({
      system: systemFor(lang),
      instruction,
      schema: FINDINGS_SCHEMA,
      what: `заключение (${modality.key})`,
      effort: EFFORT.analysis,
    });

    return { ...normalizeFindings(parsed), usage, model, promptVersion: PROMPT_VERSION };
  },
};

/* ─── labs: правила + объяснение моделью ──────────────────────────────── */
export const labsAnalyzer = {
  key: "labs",
  async run({ caseDoc, artifacts, modality, lang }) {
    // Панель может прийти структурой (предпочтительно) или текстом.
    const panels = artifacts
      .filter((a) => Array.isArray(a.structured?.items))
      .flatMap((a) => a.structured.items);

    const texts = artifactTexts(artifacts);
    if (!panels.length && !texts) {
      return { skipped: true, reason: "нет ни панели показателей, ни текста анализов" };
    }

    // Считает КОД. Модель эти цифры не пересчитывает и не оспаривает.
    const computed = panels.length ? analyzePanel(panels) : null;

    const computedBlock = computed
      ? [
          "РАСЧЁТ ПО РЕФЕРЕНСАМ (выполнен детерминированно, это факты — не пересчитывай):",
          ...computed.abnormal.map(
            (i) =>
              `- ${i.name}: ${i.value}${i.unit ? " " + i.unit : ""} — ${
                i.status === "low" ? "ниже" : "выше"
              } нормы (${i.refLow ?? "—"}–${i.refHigh ?? "—"})${
                i.borderline ? ", пограничное" : ""
              }${i.critical ? `, КРИТИЧЕСКОЕ: ${i.critical.why}` : ""}`,
          ),
          computed.unknown.length
            ? `Не сравнивались (нет референса или значение не число): ${computed.unknown
                .map((i) => i.name)
                .join(", ")}`
            : null,
          ...(computed.pairs.length
            ? ["Связки показателей, которые нужно учесть:", ...computed.pairs.map((p) => `- ${p.note}`)]
            : []),
        ]
          .filter(Boolean)
          .join("\n")
      : "Структурированная панель не приложена — работай по тексту.";

    const instruction = [
      caseHeader(caseDoc),
      "",
      protocolBlock(modality),
      "",
      computedBlock,
      texts ? `\nТЕКСТ АНАЛИЗОВ:\n${texts}` : "",
      "",
      "Объясни клинический смысл отклонений: что они значат вместе, что вторично,",
      "что перепроверить и чего не хватает. Числа бери только из расчёта выше.",
    ]
      .filter(Boolean)
      .join("\n");

    const { parsed, usage, model } = await runJson({
      system: systemFor(lang),
      instruction,
      schema: FINDINGS_SCHEMA,
      what: "лабораторную панель",
      effort: EFFORT.analysis,
    });

    const normalized = normalizeFindings(parsed);

    // Критические значения добавляем САМИ, не полагаясь на модель: это
    // единственные выводы в модуле, которые обязаны появиться независимо от
    // того, что ответила модель и ответила ли вообще.
    const criticalFindings = (computed?.critical ?? []).map((i) => ({
      title: `Критическое значение: ${i.name} ${i.value}${i.unit ? " " + i.unit : ""}`,
      detail: `Порог ${i.critical.direction === "low" ? "снизу" : "сверху"} ${
        i.critical.threshold
      }: ${i.critical.why}. Значение получено сравнением с порогом, а не оценкой модели.`,
      severity: "critical",
      confidence: "high",
      checklistItem: "Критические значения, требующие немедленных действий",
      recommendations: ["Свяжитесь с пациентом и подтвердите результат повторным забором"],
      citations: [],
    }));

    return {
      ...normalized,
      findings: [...criticalFindings, ...normalized.findings].slice(0, 14),
      computed: computed?.summary ?? null,
      usage,
      model,
      promptVersion: PROMPT_VERSION,
    };
  },
};

/* ─── clinical: случай целиком ────────────────────────────────────────── */
export const clinicalAnalyzer = {
  key: "clinical",
  async run({ caseDoc, artifacts, modality, lang }) {
    const texts = artifactTexts(artifacts);
    const header = caseHeader(caseDoc);
    if (!texts && !header) {
      return { skipped: true, reason: "в деле нет ни контекста, ни текстовых материалов" };
    }

    const instruction = [
      header,
      "",
      protocolBlock(modality),
      texts ? `\nМАТЕРИАЛЫ ДЕЛА:\n${texts}` : "",
      "",
      "Дай разбор случая: какие версии стоит держать в голове (включая редкие, но опасные),",
      "что в первую очередь исключить, какие обследования дадут больше всего информации",
      "и чего в описании не хватает. Не выбирай один диагноз как ответ.",
    ]
      .filter(Boolean)
      .join("\n");

    const { parsed, usage, model } = await runJson({
      system: systemFor(lang),
      instruction,
      schema: FINDINGS_SCHEMA,
      what: "клинический случай",
      effort: EFFORT.analysis,
    });

    return { ...normalizeFindings(parsed), usage, model, promptVersion: PROMPT_VERSION };
  },
};

const ANALYZERS = {
  report: reportAnalyzer,
  labs: labsAnalyzer,
  clinical: clinicalAnalyzer,
};

export function getAnalyzer(key) {
  return ANALYZERS[key] ?? null;
}

export function listAnalyzerKeys() {
  return Object.keys(ANALYZERS);
}
