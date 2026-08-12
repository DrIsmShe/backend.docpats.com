// __tests__/ebm/question.test.js
//
// Разбор свободного вопроса врача. Модель здесь замокана: проверяется НАША
// логика вокруг неё — что уходит в PubMed, когда запрос расширяется и что
// видит врач. Качество самого разбора тестом не проверить, оно проверяется
// живым прогоном.
//
// Отдельно и намеренно проверяется, что модель не может подсунуть публикацию:
// это главное обещание модуля.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Клиент модели подменяется на уровне модуля-источника: сервис берёт его
// через getClient() из education-экстрактора.
const createMock = vi.fn();

vi.mock(
  "../../modules/education/education-ingest/extractors/claude.extractor.js",
  () => ({
    getClient: () => ({ beta: { messages: { create: createMock } } }),
    withApiRetry: async (run) => run("claude-sonnet-5"),
    describeApiError: (err) => ({
      message: String(err?.message || err),
      retryable: false,
    }),
  }),
);

const { parseQuestion, askEvidence } = await import(
  "../../modules/ebm/services/question.service.js"
);

// ─── ответы модели ─────────────────────────────────────────────────────────

function modelReturns(payload, extra = {}) {
  createMock.mockResolvedValue({
    model: "claude-sonnet-5",
    stop_reason: "end_turn",
    content: [
      // Первым блоком идёт размышление — брать content[0] нельзя. На этом уже
      // спотыкался модуль справочника кодов.
      { type: "thinking", thinking: "рассуждение модели" },
      { type: "text", text: JSON.stringify(payload) },
    ],
    ...extra,
  });
}

const GOOD = {
  isClinical: true,
  pico: {
    population: "Взрослые с преддиабетом",
    intervention: "Метформин",
    comparison: "",
    outcome: "Переход в диабет 2 типа",
  },
  query: "(prediabetes[tiab]) AND (metformin[tiab])",
  broadQuery: "metformin",
  englishTerms: ["metformin", "prediabetes"],
  note: "",
};

// ─── мок PubMed ────────────────────────────────────────────────────────────

let pubmedCounts = {};
let searchTerms = [];

function pubmedFor(term) {
  const key = Object.keys(pubmedCounts).find((k) => term.includes(k));
  return pubmedCounts[key] ?? 0;
}

beforeEach(() => {
  createMock.mockReset();
  pubmedCounts = {};
  searchTerms = [];
  process.env.ANTHROPIC_API_KEY = "test-key";

  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const parsed = new URL(String(url));
    const term = parsed.searchParams.get("term") || "";

    if (parsed.pathname.endsWith("esearch.fcgi")) {
      searchTerms.push(term);
      const count = pubmedFor(term);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          esearchresult: {
            count: String(count),
            idlist: count > 0 ? ["1"] : [],
            querytranslation: count > 0 ? "ok" : "",
            errorlist: { phrasesnotfound: [] },
          },
        }),
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          uids: ["1"],
          1: {
            uid: "1",
            title: "Real study from PubMed",
            source: "BMJ",
            pubdate: "2022",
            authors: [],
            articleids: [{ idtype: "pubmed", value: "1" }],
            pubtype: [],
          },
        },
      }),
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── разбор ────────────────────────────────────────────────────────────────

describe("разбор вопроса", () => {
  it("достаёт ответ, не спотыкаясь о блок размышления", async () => {
    modelReturns(GOOD);

    const res = await parseQuestion("Помогает ли метформин при преддиабете?");

    expect(res.query).toBe("(prediabetes[tiab]) AND (metformin[tiab])");
    expect(res.pico.population).toBe("Взрослые с преддиабетом");
  });

  it("отвергает пустой и слишком длинный вопрос, не тревожа модель", async () => {
    await expect(parseQuestion("а?")).rejects.toThrow(/короткий/i);
    await expect(parseQuestion("а".repeat(1001))).rejects.toThrow(/длинный/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("объясняет отказ модели и подсказывает обходной путь", async () => {
    // Медицинская тема ловит фильтры безопасности чаще прочих: отравление,
    // передозировка, инфекция. Врач должен понять, что дело в формулировке.
    createMock.mockResolvedValue({
      model: "claude-sonnet-5",
      stop_reason: "refusal",
      content: [],
    });

    await expect(parseQuestion("вопрос про передозировку")).rejects.toThrow(
      /переформулируйте/i,
    );
  });

  it("не выдаёт оборванный ответ за результат", async () => {
    createMock.mockResolvedValue({
      model: "claude-sonnet-5",
      stop_reason: "max_tokens",
      content: [{ type: "text", text: '{"isClinical":' }],
    });

    await expect(parseQuestion("длинный вопрос про лечение")).rejects.toThrow(
      /оборвал/i,
    );
  });

  it("без ключа модели говорит, что поиск по запросу работает и так", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;

    await expect(parseQuestion("любой вопрос")).rejects.toThrow(/ebm\/search/);
  });
});

// ─── полный путь ───────────────────────────────────────────────────────────

describe("вопрос → PubMed", () => {
  it("ищет по запросу, который построила модель", async () => {
    modelReturns(GOOD);
    pubmedCounts = { metformin: 500 };

    const res = await askEvidence({
      question: "Помогает ли метформин при преддиабете?",
      perLevel: 1,
    });

    expect(res.usedQuery).toBe(GOOD.query);
    expect(res.widened).toBe(false);
    expect(searchTerms[0]).toBe(GOOD.query);
  });

  it("расширяет запрос, когда точный не нашёл ничего", async () => {
    // Пустая выдача чаще означает «граней в запросе слишком много», а не
    // «доказательств нет». Врач без опыта работы с PubMed этого не различит.
    modelReturns({
      ...GOOD,
      query: "(very AND narrow AND query)",
      broadQuery: "(broad)",
    });
    pubmedCounts = { broad: 42 };

    const res = await askEvidence({ question: "узкий вопрос", perLevel: 1 });

    expect(res.widened).toBe(true);
    expect(res.usedQuery).toBe("(broad)");
    expect(res.totalAnyDesign).toBe(42);
  });

  it("не расширяет, когда точный запрос сработал", async () => {
    modelReturns(GOOD);
    pubmedCounts = { prediabetes: 100, metformin: 100 };

    const res = await askEvidence({ question: "вопрос про метформин" });

    expect(res.widened).toBe(false);
    expect(searchTerms.some((t) => t === "metformin")).toBe(false);
  });

  it("остаётся честным, если не нашлось и по широкому запросу", async () => {
    modelReturns({ ...GOOD, query: "(a AND b)", broadQuery: "(c)" });
    pubmedCounts = {};

    const res = await askEvidence({ question: "вопрос без литературы" });

    // Не выдумываем результат и не молчим: «ничего не найдено» — это ответ.
    expect(res.totalAnyDesign).toBe(0);
    expect(res.widened).toBe(false);
    expect(res.verdict.kind).toMatch(/nothing|not_understood/);
  });

  it("на неклинический вопрос не тревожит PubMed вовсе", async () => {
    modelReturns({
      isClinical: false,
      pico: { population: "", intervention: "", comparison: "", outcome: "" },
      query: "",
      broadQuery: "",
      englishTerms: [],
      note: "Это приветствие.",
    });

    const res = await askEvidence({ question: "привет как дела" });

    // На «hello» PubMed ответит тысячами работ, и это будет выглядеть как
    // результат поиска.
    expect(res.verdict.kind).toBe("not_clinical");
    expect(searchTerms).toHaveLength(0);
  });

  it("показывает врачу, по какому запросу отвечено", async () => {
    modelReturns(GOOD);
    pubmedCounts = { metformin: 10, prediabetes: 10 };

    const res = await askEvidence({ question: "вопрос про метформин" });

    // Без этого система превращается в оракула: ответ есть, а проверить,
    // о том ли спросили PubMed, нельзя.
    expect(res.usedQuery).toBeTruthy();
    expect(res.understood.pico).toBeTruthy();
    expect(res.understood.englishTerms).toContain("metformin");
  });
});

// ─── главное обещание модуля ───────────────────────────────────────────────

describe("модель не может подсунуть публикацию", () => {
  it("в выдачу попадает только то, что вернул PubMed", async () => {
    // Модель пытается протащить «источник» через все текстовые поля.
    modelReturns({
      ...GOOD,
      note: "См. Ivanov et al., Lancet 2021, PMID 99999999, doi:10.1/fake",
      englishTerms: ["Smith J, NEJM 2019;380:1"],
    });
    pubmedCounts = { prediabetes: 5, metformin: 5 };

    const res = await askEvidence({
      question: "вопрос про метформин",
      perLevel: 1,
    });

    // Все карточки — из ответа PubMed, а не из текста модели. Любой другой
    // источник публикаций в этом модуле означал бы ровно ту ошибку, ради
    // которой он и строился.
    const items = res.levels.flatMap((l) => l.items);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.title).toBe("Real study from PubMed");
      expect(item.url).toBe("https://pubmed.ncbi.nlm.nih.gov/1/");
    }
    // Придуманный PMID не стал ссылкой ни в одной карточке.
    expect(items.some((i) => i.pmid === "99999999")).toBe(false);
  });
});
