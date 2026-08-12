// __tests__/ebm/evidenceSearch.test.js
//
// Отбор доказательств. PubMed здесь замокан: тесты проверяют НАШУ логику —
// какой запрос уходит, как раскладывается ответ и что говорится врачу.
// Живой PubMed проверяется отдельно, руками, и его ответы меняются со
// временем — опираться на них в CI нельзя.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  searchEvidence,
  EVIDENCE_LEVELS,
} from "../../modules/ebm/services/evidence.service.js";

// ─── мок PubMed ────────────────────────────────────────────────────────────
//
// Отвечает по правилам, а не заранее заготовленной очередью ответов: очередь
// заставила бы тест знать точное ЧИСЛО обращений, а это как раз то, что мы
// хотим проверять свободно.

let calls = [];
let rules = [];
let summaries = {};

/** Что вернуть на esearch с таким термином. Первое совпадение выигрывает. */
function whenSearch(match, response) {
  rules.push({ match, response });
}

function esearchResponse(term) {
  const rule = rules.find((r) =>
    typeof r.match === "function" ? r.match(term) : term.includes(r.match),
  );
  const { count = 0, ids = [], notFound = [] } = rule?.response || {};
  return {
    esearchresult: {
      count: String(count),
      idlist: ids,
      querytranslation: count > 0 ? `"${term}"[All Fields]` : "",
      errorlist: { phrasesnotfound: notFound },
      warninglist: { phrasesignored: [] },
    },
  };
}

function esummaryResponse(ids) {
  const result = { uids: ids };
  for (const id of ids) result[id] = summaries[id];
  return { result };
}

beforeEach(() => {
  calls = [];
  rules = [];
  summaries = {};

  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const parsed = new URL(String(url));
    const endpoint = parsed.pathname.split("/").pop();
    const term = parsed.searchParams.get("term") || "";
    calls.push({ endpoint, term });

    const body =
      endpoint === "esearch.fcgi"
        ? esearchResponse(term)
        : esummaryResponse((parsed.searchParams.get("id") || "").split(","));

    return { ok: true, status: 200, json: async () => body };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const searchCalls = () => calls.filter((c) => c.endpoint === "esearch.fcgi");

// ─── главный регресс ───────────────────────────────────────────────────────

describe("запрос, который PubMed не понял", () => {
  // ЭТО САМЫЙ ВАЖНЫЙ ТЕСТ ФАЙЛА.
  //
  // На живом PubMed фраза «хренотень какая-то несуществующая» вернула
  // 2 447 841 публикацию, среди них 1962 «мета-анализа». Не выдумка модели —
  // настоящие работы с настоящими PMID, просто ни одна не про вопрос врача.
  // Причина: PubMed молча выбрасывает слова, которых не знает, скобка
  // «(запрос)» становится пустой, и «(пусто) NOT комментарии» означает уже не
  // «ничего», а «вся база минус комментарии».
  //
  // Опаснее пустого ответа: пустой ответ виден сразу, а этот выглядит как
  // исчерпывающая подборка доказательств.
  it("не превращается в «вся база минус комментарии»", async () => {
    whenSearch(() => true, { count: 0 });

    const res = await searchEvidence({ term: "хренотень несуществующая" });

    expect(res.totalAnyDesign).toBe(0);
    expect(res.levels).toEqual([]);
    expect(res.verdict.kind).toBe("not_understood");
  });

  it("проверяет запрос голым, без NOT-фильтра", async () => {
    whenSearch(() => true, { count: 0 });

    await searchEvidence({ term: "непонятное слово" });

    // Первое обращение — ровно введённый текст. Если приклеить к нему фильтры
    // сразу, пустая скобка снова даст ложное «нашлось».
    expect(searchCalls()[0].term).toBe("непонятное слово");
    expect(searchCalls()[0].term).not.toContain("NOT");
  });

  it("на пустой теме тратит один запрос вместо шести", async () => {
    whenSearch(() => true, { count: 0 });

    await searchEvidence({ term: "nothing here at all" });

    // Не только про скорость: лимит NCBI общий на весь проект, и пять лишних
    // обращений на заведомо пустом запросе отнимают их у других врачей.
    expect(searchCalls()).toHaveLength(1);
  });

  it("про кириллицу говорит прямо, что PubMed только английский", async () => {
    whenSearch(() => true, { count: 0 });

    const res = await searchEvidence({ term: "метформин преддиабет" });

    expect(res.verdict.kind).toBe("not_understood");
    expect(res.verdict.text).toMatch(/английск/i);
  });

  it("называет конкретные непонятые слова, если PubMed их перечислил", async () => {
    // Латиница с опечаткой: PubMed сообщает, чего именно не знает.
    whenSearch(() => true, { count: 0, notFound: ["metfrmin"] });

    const res = await searchEvidence({ term: "metfrmin prediabetes" });

    expect(res.verdict.kind).toBe("not_understood");
    expect(res.verdict.text).toContain("metfrmin");
  });
});

// ─── раскладка по ступеням ─────────────────────────────────────────────────

describe("раскладка по силе дизайна", () => {
  beforeEach(() => {
    summaries["1"] = {
      uid: "1",
      title: "Metformin in <i>prediabetes</i>: a meta-analysis",
      fulljournalname: "The Lancet",
      pubdate: "2023 Apr 15",
      authors: [
        { name: "Ivanov I", authtype: "Author" },
        { name: "Smith J", authtype: "CollectiveName" },
      ],
      articleids: [
        { idtype: "pubmed", value: "1" },
        { idtype: "doi", value: "10.1016/example" },
      ],
      pubtype: ["Meta-Analysis"],
      pubstatus: "ppublish",
    };
  });

  it("исключает мнения, редакционные статьи и письма", async () => {
    whenSearch(() => true, { count: 5, ids: ["1"] });

    await searchEvidence({ term: "metformin", perLevel: 1 });

    // Первый запрос — пробный, голый. Со второго идут отборы.
    const filtered = searchCalls().slice(1);
    expect(filtered.length).toBeGreaterThan(0);
    for (const call of filtered) {
      expect(call.term).toContain("comment[pt]");
      expect(call.term).toContain("editorial[pt]");
      expect(call.term).toContain("letter[pt]");
    }
  });

  it("идёт по всем ступеням в порядке убывания силы", async () => {
    whenSearch(() => true, { count: 3, ids: ["1"] });

    const res = await searchEvidence({ term: "metformin", perLevel: 1 });

    expect(res.levels.map((l) => l.key)).toEqual(
      EVIDENCE_LEVELS.map((l) => l.key),
    );
    expect(res.levels.map((l) => l.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("берёт только запрошенные ступени", async () => {
    whenSearch(() => true, { count: 3, ids: ["1"] });

    const res = await searchEvidence({
      term: "metformin",
      levels: ["meta_analysis"],
      perLevel: 1,
    });

    expect(res.levels).toHaveLength(1);
    // Пробный + общее число по теме + один отбор. Смысл параметра в том,
    // чтобы не тратить все шесть обращений к NCBI ради одной ступени.
    expect(searchCalls()).toHaveLength(3);
  });

  it("ограничивает период, когда попросили свежесть", async () => {
    whenSearch(() => true, { count: 3, ids: ["1"] });

    await searchEvidence({ term: "metformin", yearsBack: 5, perLevel: 1 });

    expect(searchCalls()[1].term).toContain('"last 5 years"[dp]');
    // На пробном запросе периода быть не должно: он отвечает на вопрос
    // «понял ли PubMed слова», а не «есть ли свежие работы».
    expect(searchCalls()[0].term).not.toContain("last 5 years");
  });

  it("не запрашивает карточки, когда на ступени пусто", async () => {
    whenSearch("meta-analysis", { count: 0 });
    whenSearch(() => true, { count: 2, ids: ["1"] });

    const res = await searchEvidence({ term: "metformin", perLevel: 1 });

    const meta = res.levels.find((l) => l.key === "meta_analysis");
    expect(meta.total).toBe(0);
    expect(meta.items).toEqual([]);
  });
});

// ─── карточки публикаций ───────────────────────────────────────────────────

describe("карточка публикации", () => {
  it("приводит запись к плоскому виду и чистит разметку", async () => {
    summaries["1"] = {
      uid: "1",
      title: "Metformin in <i>prediabetes</i>: a meta-analysis",
      fulljournalname: "The Lancet",
      pubdate: "2023 Apr 15",
      authors: [
        { name: "Ivanov I", authtype: "Author" },
        { name: "Study Group", authtype: "CollectiveName" },
      ],
      articleids: [
        { idtype: "pubmed", value: "1" },
        { idtype: "doi", value: "10.1016/example" },
      ],
      pubtype: ["Meta-Analysis"],
      pubstatus: "ppublish",
    };
    whenSearch(() => true, { count: 1, ids: ["1"] });

    const res = await searchEvidence({
      term: "metformin",
      levels: ["meta_analysis"],
      perLevel: 1,
    });
    const item = res.levels[0].items[0];

    expect(item.title).toBe("Metformin in prediabetes: a meta-analysis");
    expect(item.journal).toBe("The Lancet");
    expect(item.year).toBe(2023);
    expect(item.doiUrl).toBe("https://doi.org/10.1016/example");
    // Коллективные авторы в список не идут — это не фамилии.
    expect(item.authors).toEqual(["Ivanov I"]);
  });

  it("ссылается по PMID, когда DOI нет", async () => {
    // У работ до эпохи DOI его не существует вовсе, а ссылка нужна всегда.
    summaries["77"] = {
      uid: "77",
      title: "An old trial",
      source: "BMJ",
      pubdate: "1988",
      authors: [],
      articleids: [{ idtype: "pubmed", value: "77" }],
      pubtype: ["Randomized Controlled Trial"],
    };
    whenSearch(() => true, { count: 1, ids: ["77"] });

    const res = await searchEvidence({
      term: "aspirin",
      levels: ["rct"],
      perLevel: 1,
    });
    const item = res.levels[0].items[0];

    expect(item.doi).toBeNull();
    expect(item.doiUrl).toBeNull();
    expect(item.url).toBe("https://pubmed.ncbi.nlm.nih.gov/77/");
    expect(item.year).toBe(1988);
  });
});

// ─── формулировка итога ────────────────────────────────────────────────────

describe("итог для врача", () => {
  const seedSummary = (id) => {
    summaries[id] = {
      uid: id,
      title: "Some study",
      source: "BMJ",
      pubdate: "2020",
      authors: [],
      articleids: [{ idtype: "pubmed", value: id }],
      pubtype: [],
    };
  };

  it("сильные обобщающие работы — kind=strong", async () => {
    seedSummary("1");
    whenSearch(() => true, { count: 10, ids: ["1"] });

    const res = await searchEvidence({ term: "metformin", perLevel: 1 });

    expect(res.verdict.kind).toBe("strong");
  });

  it("есть РКИ, но нет обобщений — kind=trials_only", async () => {
    seedSummary("1");
    whenSearch("meta-analysis", { count: 0 });
    whenSearch("systematic review", { count: 0 });
    whenSearch("guideline", { count: 0 });
    whenSearch("randomized controlled trial", { count: 7, ids: ["1"] });
    whenSearch(() => true, { count: 40, ids: ["1"] });

    const res = await searchEvidence({ term: "rare disease drug", perLevel: 1 });

    expect(res.verdict.kind).toBe("trials_only");
    expect(res.verdict.text).toContain("7");
  });

  it("только наблюдения — kind=weak", async () => {
    seedSummary("1");
    whenSearch("meta-analysis", { count: 0 });
    whenSearch("systematic review", { count: 0 });
    whenSearch("guideline", { count: 0 });
    whenSearch("randomized controlled trial", { count: 0 });
    whenSearch(() => true, { count: 12, ids: ["1"] });

    const res = await searchEvidence({ term: "very rare thing", perLevel: 1 });

    expect(res.verdict.kind).toBe("weak");
  });

  it("никогда не говорит, работает лечение или нет", async () => {
    seedSummary("1");
    whenSearch(() => true, { count: 10, ids: ["1"] });

    const res = await searchEvidence({ term: "metformin", perLevel: 1 });

    // Итог описывает ПОЛНОТУ найденного, а не эффективность. Система, которая
    // ищет доказательства, слишком легко начинает выглядеть системой, которая
    // делает выводы, — а вывод по заголовкам делать нельзя.
    expect(res.verdict.text).not.toMatch(
      /эффективен|неэффективен|помогает|не помогает|рекомендуется|показан/i,
    );
  });
});

describe("проверка ввода", () => {
  it("отвергает слишком короткий запрос, не тревожа PubMed", async () => {
    await expect(searchEvidence({ term: "ab" })).rejects.toThrow(/короткий/i);
    expect(calls).toHaveLength(0);
  });
});
