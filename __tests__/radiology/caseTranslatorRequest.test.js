// __tests__/radiology/caseTranslatorRequest.test.js
//
// ФОРМА ЗАПРОСА к модели при переводе кейса.
//
// Зачем отдельный тест на это. Все остальные тесты переводов мокают сам
// переводчик (caseTranslator.js) — им важна логика «трогать / не трогать», а не
// разговор с API. В результате форма запроса не проверялась ни разу, и в ней
// жила ошибка, из-за которой перевод кейсов не работал ВООБЩЕ:
//
//   format: { type: "json_schema", ...prepareSchema(SCHEMA) }
//
// prepareSchema возвращает саму схему, у которой свой type — "object". Спред
// шёл после type и перетирал "json_schema", а ключа schema в объекте не
// появлялось. API отвечал 400 «output_config.format.type: Input should be
// 'json_schema'», сервис аккуратно записывал это в report.failed, публикация
// продолжалась — и кейс молча оставался без перевода на все четыре языка.
//
// Дефект был невидим на всех уровнях: в админке кейс выглядел нормально, тесты
// были зелёные, в базе просто не появлялось записей. Поэтому тест смотрит
// именно на то, что уезжает в SDK.

import { describe, it, expect, beforeEach, vi } from "vitest";

const captured = { params: null };

vi.mock("../../modules/education/education-ingest/extractors/claude.extractor.js", () => ({
  isConfigured: () => true,
  describeApiError: (err) => ({ message: String(err?.message ?? err), retryable: false }),
  getClient: () => ({
    beta: {
      messages: {
        stream: (params) => {
          captured.params = params;
          return {
            finalMessage: async () => ({
              stop_reason: "end_turn",
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    fields: [{ path: "title", text: "Kəskin pankreatit" }],
                    diagnosisKeys: ["kəskin pankreatit"],
                    diagnosisSynonyms: [],
                  }),
                },
              ],
            }),
          };
        },
      },
    },
  }),
}));

const { translateCaseContent } = await import(
  "../../modules/radiology/translation/caseTranslator.js"
);

beforeEach(() => {
  captured.params = null;
});

async function translate() {
  return translateCaseContent({
    targetLang: "az",
    sourceLang: "ru",
    fields: { title: "Острый панкреатит" },
    diagnosisKeys: ["панкреатит"],
    diagnosisSynonyms: [],
  });
}

describe("запрос на перевод кейса", () => {
  it("format.type остаётся json_schema, а схема лежит в format.schema", async () => {
    await translate();

    const format = captured.params.output_config.format;
    expect(format.type).toBe("json_schema");
    expect(format.schema).toBeTypeOf("object");
    expect(format.schema.type).toBe("object");
    // Ровно та ошибка, что была: ключи схемы, разложенные по format напрямую.
    expect(format.properties).toBeUndefined();
  });

  it("исходник помечен точкой кэширования, а язык-цель идёт после него", async () => {
    // Исходник один и тот же для всех четырёх языков; без кэша он оплачивался
    // бы по полной цене четыре раза подряд.
    await translate();

    const blocks = captured.params.messages[0].content;
    expect(blocks[0].cache_control).toEqual({ type: "ephemeral" });
    expect(blocks[0].text).toContain("Острый панкреатит");
    expect(blocks[1].cache_control).toBeUndefined();
    expect(blocks[1].text).toContain("Azerbaijani");
  });

  it("возвращает только запрошенные пути и разобранные наборы диагноза", async () => {
    const out = await translate();

    expect(out.fields).toEqual({ title: "Kəskin pankreatit" });
    expect(out.diagnosisKeys).toEqual(["kəskin pankreatit"]);
  });
});
