import { describe, it, expect, beforeEach } from "vitest";
import MedicalCode, {
  CODE_SYSTEMS,
  normalizeCode,
  buildSearchText,
} from "../../modules/medicalCodes/models/medicalCode.model.js";
import {
  searchCodes,
  getCode,
  getStats,
  resetSearchStrategy,
  buildAtlasPipeline,
} from "../../modules/medicalCodes/services/codeSearch.service.js";

// Тесты идут против mongodb-memory-server, где Atlas Search недоступен, —
// значит проверяется именно fallback-стратегия на обычном Mongo. Это и есть
// то, что работает локально и в CI, поэтому покрывать её важнее всего.

async function seed() {
  const rows = [
    {
      code: "J35.01",
      titles: { en: "Chronic tonsillitis", ru: "Хронический тонзиллит" },
    },
    {
      code: "J35.02",
      titles: { en: "Chronic adenoiditis", ru: "Хронический аденоидит" },
    },
    {
      code: "J03.0",
      titles: {
        en: "Streptococcal tonsillitis",
        ru: "Стрептококковый тонзиллит",
      },
    },
    {
      code: "E11.9",
      titles: {
        en: "Type 2 diabetes mellitus without complications",
        ru: "Сахарный диабет 2 типа без осложнений",
      },
    },
  ];

  await MedicalCode.insertMany(
    rows.map((r) => {
      const doc = {
        system: CODE_SYSTEMS.ICD10CM,
        code: r.code,
        codeNormalized: normalizeCode(r.code),
        titles: { az: "", tr: "", ar: "", ...r.titles },
        parentCode: r.code.split(".")[0],
        isBillable: true,
        version: "2026",
      };
      return { ...doc, searchText: buildSearchText(doc) };
    }),
  );
}

describe("справочник кодов — поиск", () => {
  beforeEach(async () => {
    resetSearchStrategy();
    await seed();
  });

  it("находит по точному коду", async () => {
    const { items } = await searchCodes({ query: "J35.01" });
    expect(items[0].code).toBe("J35.01");
    expect(items[0].title).toBe("Хронический тонзиллит");
  });

  it("находит по коду без точки и в нижнем регистре", async () => {
    const { items } = await searchCodes({ query: "j3501" });
    expect(items[0].code).toBe("J35.01");
  });

  it("по рубрике возвращает все её коды", async () => {
    const { items } = await searchCodes({ query: "J35" });
    const codes = items.map((i) => i.code).sort();
    expect(codes).toEqual(["J35.01", "J35.02"]);
  });

  it("находит по русскому названию", async () => {
    const { items } = await searchCodes({ query: "тонзиллит", locale: "ru" });
    const codes = items.map((i) => i.code).sort();
    expect(codes).toEqual(["J03.0", "J35.01"]);
  });

  it("находит по английскому названию", async () => {
    const { items } = await searchCodes({ query: "diabetes", locale: "en" });
    expect(items).toHaveLength(1);
    expect(items[0].code).toBe("E11.9");
  });

  it("совпадение по коду идёт раньше совпадения по названию", async () => {
    // "J03" — это код; записи с ним должны стоять выше тех, что совпали
    // только текстом.
    const { items } = await searchCodes({ query: "J03" });
    expect(items[0].code).toBe("J03.0");
  });

  it("для языка без перевода откатывается на английский", async () => {
    const { items } = await searchCodes({ query: "J35.01", locale: "az" });
    expect(items[0].title).toBe("Chronic tonsillitis");
    expect(items[0].titleEn).toBe("Chronic tonsillitis");
  });

  it("не ищет по одной букве — иначе каждый ввод бьёт по всей коллекции", async () => {
    const { items, strategy } = await searchCodes({ query: "J" });
    expect(items).toEqual([]);
    expect(strategy).toBe("none");
  });

  it("спецсимволы не ломают запрос", async () => {
    const { items } = await searchCodes({ query: "J35.01)" });
    expect(Array.isArray(items)).toBe(true);
  });

  it("уважает limit", async () => {
    const { items } = await searchCodes({ query: "тонзиллит", limit: 1 });
    expect(items).toHaveLength(1);
  });

  it("не возвращает дублей, когда код и название совпали оба", async () => {
    const { items } = await searchCodes({ query: "J35.01" });
    const codes = items.map((i) => i.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("справочник кодов — точное получение", () => {
  beforeEach(async () => {
    resetSearchStrategy();
    await seed();
  });

  it("возвращает код с названием на нужном языке", async () => {
    const item = await getCode({ code: "J35.01", locale: "ru" });
    expect(item.title).toBe("Хронический тонзиллит");
  });

  it("принимает код в любом написании", async () => {
    const item = await getCode({ code: "j3501" });
    expect(item.code).toBe("J35.01");
  });

  it("возвращает null для несуществующего кода", async () => {
    const item = await getCode({ code: "Z99.99" });
    expect(item).toBeNull();
  });
});

describe("справочник кодов — статистика", () => {
  beforeEach(async () => {
    resetSearchStrategy();
    await seed();
  });

  it("считает загруженное и переведённое", async () => {
    const stats = await getStats();
    expect(stats.total).toBe(4);
    expect(stats.bySystem[CODE_SYSTEMS.ICD10CM].total).toBe(4);
    expect(stats.bySystem[CODE_SYSTEMS.ICD10CM].translated.ru).toBe(4);
    expect(stats.bySystem[CODE_SYSTEMS.ICD10CM].translated.az).toBe(0);
  });
});

describe("справочник кодов — модель", () => {
  it("нормализует код при сохранении", async () => {
    const doc = await MedicalCode.create({
      system: CODE_SYSTEMS.ICD10CM,
      code: "j35.01",
      codeNormalized: "placeholder",
      titles: { en: "Chronic tonsillitis" },
    });
    expect(doc.codeNormalized).toBe("J3501");
  });

  it("не допускает два одинаковых кода в одной системе", async () => {
    const payload = {
      system: CODE_SYSTEMS.ICD10CM,
      code: "J35.01",
      codeNormalized: "J3501",
      titles: { en: "Chronic tonsillitis" },
    };
    await MedicalCode.create(payload);
    await expect(MedicalCode.create(payload)).rejects.toThrow();
  });

  it("допускает один код в разных системах", async () => {
    await MedicalCode.create({
      system: CODE_SYSTEMS.ICD10CM,
      code: "J35.01",
      codeNormalized: "J3501",
      titles: { en: "Chronic tonsillitis" },
    });
    const other = await MedicalCode.create({
      system: CODE_SYSTEMS.ICD10WHO,
      code: "J35.01",
      codeNormalized: "J3501",
      titles: { en: "Chronic tonsillitis (WHO)" },
    });
    expect(other.system).toBe(CODE_SYSTEMS.ICD10WHO);
  });
});

// ── Форма запроса к Atlas Search ─────────────────────────────────────────────
//
// Atlas Search недоступен в mongodb-memory-server, поэтому здесь проверяется
// не результат, а САМ ЗАПРОС. Повод конкретный: пустой text.query — это ошибка
// Atlas, а не «ноль совпадений», и на проде из-за неё каждый кириллический
// запрос падал и молча скатывался на обычный Mongo. Снаружи это выглядело как
// «просто не нашлось», а на деле не работала терпимость к опечаткам — ровно то,
// ради чего индекс и заводился.

describe("запрос к Atlas Search", () => {
  const clauses = (query, locale = "ru") =>
    buildAtlasPipeline({ query, locale })[0].$search.compound.should;

  it("не отправляет пустой запрос по коду на кириллице", () => {
    for (const clause of clauses("тонзиллит")) {
      const value = clause.text?.query ?? clause.autocomplete?.query;
      expect(value).toBeTruthy();
    }
  });

  it("то же для турецкого и арабского", () => {
    for (const query of ["bademcik iltihabı", "التهاب اللوزتين"]) {
      for (const clause of clauses(query)) {
        const value = clause.text?.query ?? clause.autocomplete?.query;
        expect(value).toBeTruthy();
      }
    }
  });

  it("ищет по коду, когда код в запросе есть", () => {
    const byCode = clauses("J35.01").filter(
      (c) =>
        c.text?.path === "codeNormalized" ||
        c.autocomplete?.path === "codeNormalized",
    );

    expect(byCode).toHaveLength(2);
    expect(byCode[0].text.query).toBe("J3501");
  });

  it("на кириллице ищет только по названиям", () => {
    const byCode = clauses("тонзиллит").filter(
      (c) =>
        c.text?.path === "codeNormalized" ||
        c.autocomplete?.path === "codeNormalized",
    );

    expect(byCode).toHaveLength(0);
  });

  it("ищет по названиям на всех пяти языках с допуском на опечатку", () => {
    const byTitle = clauses("тонзиллит").filter((c) =>
      c.text?.path?.startsWith("titles."),
    );

    expect(byTitle).toHaveLength(5);
    expect(byTitle.every((c) => c.text.fuzzy?.maxEdits >= 1)).toBe(true);
  });

  it("язык врача весит больше остальных", () => {
    const byTitle = clauses("тонзиллит", "ru").filter((c) =>
      c.text?.path?.startsWith("titles."),
    );
    const ru = byTitle.find((c) => c.text.path === "titles.ru");
    const tr = byTitle.find((c) => c.text.path === "titles.tr");

    expect(ru.text.score.boost.value).toBeGreaterThan(tr.text.score.boost.value);
  });
});
