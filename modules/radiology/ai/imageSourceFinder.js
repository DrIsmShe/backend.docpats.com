// server/modules/radiology/ai/imageSourceFinder.js
//
// ГДЕ ВЗЯТЬ СНИМОК ПОД КЕЙС.
//
// Автогенератор придумывает кейс целиком: контекст, заключение, план находок.
// Снимка он не рисует и нарисовать не может, поэтому кейс ложится черновиком
// и ждёт человека. На этом месте работа и вставала: кейс есть, а найти к нему
// подходящий кадр автор не может — искать вручную «правостороннюю
// верхнечелюстную кисту на коронарной КТ» дольше, чем написать кейс заново.
//
// Здесь модель ищет в интернете УЧЕБНЫЕ СЛУЧАИ по теме и возвращает ссылки на
// страницы, где снимок есть. Не сам файл: скачивание и загрузка остаются за
// человеком, и это не формальность — см. про лицензии ниже.
//
// ЛИЦЕНЗИИ — ГЛАВНОЕ ОГРАНИЧЕНИЕ, А НЕ ФОРМАЛЬНОСТЬ.
//
// DocPats — коммерческий продукт. Значительная часть учебных радиологических
// материалов в сети лежит под CC BY-NC (некоммерческое использование), и
// поместить такой снимок в платный тренажёр нельзя, как бы он ни подходил.
// Поэтому модель обязана называть лицензию каждой находки, а не только
// ссылку, и мы отдельно помечаем, годится ли источник для коммерческого
// использования. Решение всё равно принимает человек — но принимает его,
// видя лицензию, а не догадываясь о ней.
//
// ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ: автоматической загрузки найденного снимка в
// кейс. Между «модель нашла страницу» и «изображение попало в учебный
// продукт» стоят проверка лицензии, проверка того, что на кадре
// действительно нужная находка, и деидентификация. Ни одно из трёх машина за
// человека не сделает.

import { getClient, isConfigured } from "../../education/education-ingest/extractors/claude.extractor.js";
import { withApiRetry } from "../../education/education-ingest/extractors/claude.extractor.js";
import { MODEL } from "./aiRunner.js";
import { ValidationError, ServiceUnavailableError } from "../../../common/utils/errors.js";
import logger from "../../../common/logger.js";

const log = logger.child({ module: "radiology/imageSourceFinder" });

// Инструмент веб-поиска. Версия та же, что принимает модель Opus 5;
// на более старых моделях API вернёт 400 — поэтому переключатель ниже.
const SEARCH_TOOL = "web_search_20260209";
const MAX_SEARCHES = 6;

// Ресурсы, с которых стоит начинать. Порядок — по пригодности для нашего
// случая, а не по известности:
//   • Radiopaedia — самая большая база учебных случаев, но CC BY-NC-SA:
//     для платного продукта не годится, зато годится как ориентир «как это
//     выглядит» и как источник, у которого можно спросить разрешение;
//   • MedPix (NIH) и Open-i (NLM) — государственные базы США, значительная
//     часть материалов в общественном достоянии;
//   • Wikimedia Commons — лицензия у каждого файла своя, но всегда указана;
//   • статьи в открытом доступе (PMC) — часто CC BY, то есть пригодны и
//     коммерчески при указании авторства.
const PREFERRED_SITES = [
  "radiopaedia.org",
  "medpix.nlm.nih.gov",
  "openi.nlm.nih.gov",
  "commons.wikimedia.org",
  "ncbi.nlm.nih.gov/pmc",
];

const SYSTEM = [
  "Ты помогаешь врачу-преподавателю найти РЕАЛЬНЫЙ учебный снимок под уже",
  "написанный клинический кейс.",
  "",
  "Твоя задача — найти страницы, на которых снимок ДЕЙСТВИТЕЛЬНО есть, и",
  "честно сказать, насколько он соответствует теме и на каких условиях его",
  "можно использовать.",
  "",
  "Жёсткие правила:",
  "1. Ссылка должна вести на конкретный случай или файл, а не на раздел",
  "   сайта, поиск или список. Ссылка на главную страницу ресурса бесполезна.",
  "2. Для КАЖДОЙ находки укажи лицензию так, как она указана на странице.",
  "   Не угадывай: если лицензию найти не удалось — так и напиши.",
  "   Это важнее, чем количество находок: продукт коммерческий, и материал",
  "   под CC BY-NC в него поместить нельзя.",
  "3. Не выдумывай ссылки. Лучше три проверенные, чем десять правдоподобных.",
  "   Каждый URL должен быть тем, который ты действительно видел в выдаче.",
  "4. Скажи, что именно на снимке и чем он отличается от темы кейса, если",
  "   отличается. Приблизительное совпадение — нормальный результат, но врач",
  "   должен знать, что оно приблизительное.",
  "5. Модальность и проекция должны совпадать с кейсом. КТ вместо МРТ или",
  "   аксиальный срез вместо коронарного — это НЕ подходящая находка, даже",
  "   если диагноз тот же; так и помечай.",
].join("\n");

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sources", "advice"],
  properties: {
    sources: {
      type: "array",
      description: "Найденные страницы со снимками. Не больше восьми.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["url", "site", "title", "whatIsShown", "license", "commercialUse", "match"],
        properties: {
          url: { type: "string", description: "Прямая ссылка на случай или файл" },
          site: { type: "string", description: "Ресурс: Radiopaedia, MedPix, Wikimedia…" },
          title: { type: "string", description: "Название случая на странице" },
          whatIsShown: {
            type: "string",
            description: "Что на снимке: модальность, проекция, находка",
          },
          license: {
            type: "string",
            description: "Лицензия, как указана на странице; «не указана», если найти не удалось",
          },
          commercialUse: {
            type: "string",
            enum: ["yes", "no", "unclear"],
            description: "Годится ли для коммерческого продукта по этой лицензии",
          },
          match: {
            type: "string",
            enum: ["exact", "close", "partial"],
            description: "Насколько соответствует теме кейса",
          },
          matchNote: {
            type: "string",
            description: "Чем отличается от темы, если отличается",
          },
        },
      },
    },
    advice: {
      type: "string",
      description:
        "Короткий совет автору: что искать вручную, если находок мало, какими словами.",
    },
  },
};

/**
 * Найти в интернете снимки под тему кейса.
 *
 * @param {object} p
 * @param {string} p.topic     тема кейса (или его название)
 * @param {string} [p.modality] модальность: cxr, ct, mri, us, ecg
 * @param {string} [p.hint]     чем уточнить поиск
 * @returns {Promise<{sources: object[], advice: string, model: string}>}
 */
export async function findCaseImageSources({ topic, modality = "", hint = "" }) {
  if (!isConfigured()) {
    throw new ServiceUnavailableError(
      "ИИ не настроен: задайте ANTHROPIC_API_KEY в .env сервера",
    );
  }
  const theme = String(topic ?? "").trim();
  if (theme.length < 3) {
    throw new ValidationError("Опишите тему кейса — по двум буквам искать нечего");
  }

  const client = getClient();

  const instruction = [
    `Тема кейса: ${theme}`,
    modality ? `Модальность: ${modality}` : null,
    hint ? `Уточнение автора: ${String(hint).slice(0, 300)}` : null,
    "",
    "Найди учебные случаи с изображением по этой теме. Начни с ресурсов:",
    ...PREFERRED_SITES.map((s) => `• ${s}`),
    "",
    "Если на них подходящего нет — ищи шире, но правило про лицензию остаётся.",
    "Верни находки в порядке пригодности: сначала те, что и по модальности",
    "совпадают, и коммерчески пригодны.",
  ]
    .filter(Boolean)
    .join("\n");

  let message;
  try {
    message = await withApiRetry(
      async (attemptModel) => {
        const stream = client.beta.messages.stream({
          model: attemptModel,
          max_tokens: 8000,
          thinking: { type: "adaptive" },
          system: SYSTEM,
          // Поиск и структурирование одним вызовом: модель ищет, читает
          // выдачу и сразу раскладывает найденное по схеме.
          tools: [{ type: SEARCH_TOOL, name: "web_search", max_uses: MAX_SEARCHES }],
          output_config: { format: { type: "json_schema", schema: SCHEMA } },
          messages: [{ role: "user", content: instruction }],
        });
        return await stream.finalMessage();
      },
      { logger: log, what: "поиск снимков", model: MODEL },
    );
  } catch (err) {
    log.error({ err, theme, modality }, "поиск снимков не удался");
    throw new ServiceUnavailableError(
      `Не удалось найти снимки: ${err?.message ?? "ошибка обращения к модели"}`,
    );
  }

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock) throw new ServiceUnavailableError("Модель вернула пустой ответ");

  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    throw new ServiceUnavailableError("Модель вернула неразборчивый ответ");
  }

  const clean = (s, max) => String(s ?? "").trim().slice(0, max);

  return {
    sources: (parsed.sources ?? [])
      .slice(0, 8)
      // Ссылка — единственное, без чего находка бессмысленна.
      .filter((s) => /^https?:\/\//i.test(String(s?.url ?? "")))
      .map((s) => ({
        url: clean(s.url, 500),
        site: clean(s.site, 80),
        title: clean(s.title, 300),
        whatIsShown: clean(s.whatIsShown, 500),
        license: clean(s.license, 200) || "не указана",
        commercialUse: ["yes", "no", "unclear"].includes(s.commercialUse)
          ? s.commercialUse
          : "unclear",
        match: ["exact", "close", "partial"].includes(s.match) ? s.match : "partial",
        matchNote: clean(s.matchNote, 300),
      })),
    advice: clean(parsed.advice, 1000),
    model: message.model ?? MODEL,
  };
}
