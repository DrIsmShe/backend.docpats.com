// __tests__/userSynthesis/citationCheck.test.js
//
// Сверка списка литературы с реестром Crossref.
//
// Повод измеренный: у четырёх опубликованных статей из 38 ссылок 5 указывали на
// несуществующий DOI, а 8 — на реальный DOI ЧУЖОЙ работы. Вторая категория
// опаснее: читатель нажимает, попадает на настоящую статью в настоящем журнале
// и не видит подлога.
//
// Сеть замокана: проверяется логика решения (что удалить, что оставить), а не
// доступность стороннего сервиса.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import {
  parseReferences,
  verifyReference,
  verifyAndAnnotate,
  titleSimilarity,
  clearCitationCache,
} from "../../common/services/citationCheck.service.js";

const REAL = "10.1016/S0140-6736(13)61613-X";
const FAKE = "10.1001/jamaoto.2019.0221";
const SWAPPED = "10.3892/etm.2020.8521";

const CROSSREF = {
  [REAL]: "Auditory and non-auditory effects of noise on health",
  [SWAPPED]: "Oral exposure of sulpiride promotes the proliferation of Brown-Norway rats",
};

beforeEach(() => {
  // Ответы реестра кэшируются между вызовами — без сброса прошлые ответы
  // подменяли бы новые, и проверка «реестр недоступен» ничего бы не проверяла.
  clearCitationCache();

  vi.stubGlobal("fetch", async (url) => {
    const u = String(url);

    // Система Handle: отвечает за существование DOI в ЛЮБОМ реестре. Проверка
    // спрашивает её, когда Crossref работу не знает, — иначе настоящая книга
    // или набор данных выглядели бы выдумкой.
    if (u.includes("doi.org/api/handles")) {
      const doi = decodeURIComponent(u.split("/api/handles/")[1] || "");
      return {
        ok: true,
        json: async () => ({ responseCode: CROSSREF[doi] ? 1 : 100 }),
      };
    }

    const doi = decodeURIComponent(u.split("/works/")[1] || "");
    const title = CROSSREF[doi];
    if (!title) return { ok: false, status: 404 };
    return { ok: true, json: async () => ({ message: { title: [title] } }) };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ref = (n, authors, title, doi) =>
  `[${n}] ${authors} ${title}. The Lancet. 2014; 383(9925): 1325-1332. https://doi.org/${doi}`;

describe("разбор списка литературы", () => {
  it("делит записи по номерам, а не по переводам строк", async () => {
    // В базе список хранится одной строкой: переносов может не быть вовсе.
    const list =
      ref(1, "Basner M.", "Auditory and non-auditory effects of noise on health", REAL) +
      "  " +
      ref(2, "Smith J.", "Something else entirely", FAKE);

    const refs = parseReferences(list);

    expect(refs).toHaveLength(2);
    expect(refs[0].doi).toBe(REAL);
    expect(refs[1].doi).toBe(FAKE);
  });

  it("вытаскивает название работы", () => {
    const refs = parseReferences(
      ref(1, "Basner M., Babisch W.", "Auditory and non-auditory effects of noise on health", REAL),
    );

    expect(refs[0].claimedTitle).toContain("Auditory and non-auditory effects");
  });
});

describe("проверка одной ссылки", () => {
  it("подтверждает существующую работу с верным названием", async () => {
    const [r] = parseReferences(
      ref(1, "Basner M.", "Auditory and non-auditory effects of noise on health", REAL),
    );

    expect((await verifyReference(r)).status).toBe("ok");
  });

  it("ловит несуществующий DOI", async () => {
    const [r] = parseReferences(ref(1, "Smith J.", "Nice sounding title", FAKE));

    expect((await verifyReference(r)).status).toBe("not-found");
  });

  it("ловит подмену: DOI настоящий, работа другая", async () => {
    // Самый опасный случай — снаружи выглядит безупречно.
    const [r] = parseReferences(
      ref(1, "Zhang L.", "Automated nasopharyngeal carcinoma segmentation in MRI", SWAPPED),
    );

    const verdict = await verifyReference(r);
    expect(verdict.status).toBe("mismatch");
    expect(verdict.realTitle).toContain("sulpiride");
  });

  it("сокращённое название всё же засчитывается", async () => {
    // «Septoplasty» против «Septoplasty: basic and advanced techniques» — это
    // разница в оформлении, а не подмена работы.
    expect(titleSimilarity("Septoplasty", "Septoplasty: basic and advanced techniques"))
      .toBeGreaterThanOrEqual(0.5);
  });

  it("запись без DOI подтвердить нечем", async () => {
    const [r] = parseReferences("[1] World Health Organization. Make Listening Safe. WHO. 2015.");

    expect((await verifyReference(r)).status).toBe("no-doi");
  });
});

describe("пометка списка", () => {
  const list = [
    ref(1, "Basner M.", "Auditory and non-auditory effects of noise on health", REAL),
    ref(2, "Smith J.", "A systematic review that does not exist", FAKE),
    ref(3, "Zhang L.", "Automated nasopharyngeal carcinoma segmentation in MRI", SWAPPED),
  ].join("\n");

  it("несуществующую работу УБИРАЕТ, оставляя уведомление", async () => {
    // «Такого DOI нет» — факт из реестра, а не суждение: показывать выдумку в
    // оформлении научной ссылки нельзя даже со сноской, потому что читатель
    // считывает форму раньше примечания.
    const res = await verifyAndAnnotate(list);

    expect(res.text).not.toContain("does not exist");
    expect(res.text).toMatch(/Источник удалён/);
    expect(res.replaced).toBe(1);
    expect(res.flagged.find((f) => f.status === "not-found").action)
      .toBe("replaced");
  });

  it("номер несуществующей ссылки сохраняет", async () => {
    // В тексте статьи стоит [2]; убрать строку целиком — оставить указание в
    // никуда.
    const res = await verifyAndAnnotate(list);

    expect(res.text).toContain("[2]");
  });

  it("спорную ссылку НЕ удаляет, а помечает", async () => {
    // Подмена определяется сравнением названий, а сравнение уже однажды
    // ошибалось. Удаление по суждению необратимо уносит настоящий источник.
    const res = await verifyAndAnnotate(list);

    expect(res.text).toContain("nasopharyngeal");
    expect(res.flagged.find((f) => f.status === "mismatch").action)
      .toBe("flagged");
  });

  it("у подмены показывает, на что DOI ведёт на самом деле", async () => {
    // Читателю мало знать «не подтверждено» — важно увидеть, что по ссылке
    // лежит совсем другая работа.
    const res = await verifyAndAnnotate(list);

    expect(res.text).toContain("sulpiride");
    expect(res.flagged.find((f) => f.status === "mismatch").realTitle)
      .toContain("sulpiride");
  });

  it("подтверждённую ссылку не помечает", async () => {
    const res = await verifyAndAnnotate(list);
    const firstLine = res.text.split("\n")[0];

    expect(firstLine).toContain("Auditory and non-auditory");
    expect(firstLine).not.toContain("не подтверждено");
    expect(res.ok).toBe(1);
  });

  it("сохраняет исходную нумерацию", async () => {
    // В тексте статьи стоят ссылки вида [3]; сдвиг нумерации превратил бы их
    // в указания на чужие работы — ровно в ту ошибку, которую и ищем.
    const res = await verifyAndAnnotate(list);

    expect(res.text).toContain("[1]");
    expect(res.text).toContain("[2]");
    expect(res.text).toContain("[3]");
  });

  it("при недоступном реестре не помечает ничего", async () => {
    clearCitationCache();
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });

    const res = await verifyAndAnnotate(list);

    expect(res.flagged).toHaveLength(0);
    expect(res.unchecked).toBe(3);
    expect(res.text).not.toContain("не подтверждено");
  });

  it("пустой список не ломает проверку", async () => {
    const res = await verifyAndAnnotate("");
    expect(res.ok).toBe(0);
  });
});

// Повторный прогон проверки не должен «подтверждать» подделку собственной
// пометкой: в пометке о подмене стоит настоящее название работы, и при втором
// проходе оно оказывалось внутри текста ссылки. Ошибка тихая и
// самоподтверждающаяся — один лишний запуск скрипта отменял всю проверку.
describe("повторный прогон", () => {
  const list = [
    ref(1, "Basner M.", "Auditory and non-auditory effects of noise on health", REAL),
    ref(3, "Zhang L.", "Automated nasopharyngeal carcinoma segmentation in MRI", SWAPPED),
  ].join("\n");

  it("не засчитывает подмену по своей же пометке", async () => {
    const first = await verifyAndAnnotate(list);
    expect(first.flagged.filter((f) => f.status === "mismatch")).toHaveLength(1);

    const second = await verifyAndAnnotate(first.text);

    expect(second.flagged.filter((f) => f.status === "mismatch")).toHaveLength(1);
    expect(second.ok).toBe(1);
  });

  it("не копит пометки при каждом запуске", async () => {
    const first = await verifyAndAnnotate(list);
    const second = await verifyAndAnnotate(first.text);
    const third = await verifyAndAnnotate(second.text);

    const count = (t) => (t.match(/не подтверждено/g) || []).length;
    expect(count(third.text)).toBe(count(first.text));
  });
});

// Повторный запуск на уже обработанном списке не должен ничего менять: скрипт
// проверки задуман как безопасный к повтору, иначе его нельзя ни поставить в
// расписание, ни перезапустить после сбоя.
describe("идемпотентность", () => {
  const list = [
    ref(1, "Basner M.", "Auditory and non-auditory effects of noise on health", REAL),
    ref(2, "Smith J.", "A systematic review that does not exist", FAKE),
    ref(3, "Zhang L.", "Automated nasopharyngeal carcinoma segmentation in MRI", SWAPPED),
  ].join("\n");

  it("второй прогон даёт тот же текст, что первый", async () => {
    const first = await verifyAndAnnotate(list);
    const second = await verifyAndAnnotate(first.text);

    expect(second.text).toBe(first.text);
  });

  it("убранная запись остаётся убранной, а не становится «без DOI»", async () => {
    const first = await verifyAndAnnotate(list);
    const second = await verifyAndAnnotate(first.text);

    expect(second.replaced).toBe(1);
    expect(second.flagged.some((f) => f.status === "no-doi")).toBe(false);
  });

  it("третий прогон тоже ничего не меняет", async () => {
    const first = await verifyAndAnnotate(list);
    const second = await verifyAndAnnotate(first.text);
    const third = await verifyAndAnnotate(second.text);

    expect(third.text).toBe(second.text);
  });
});

// Crossref регистрирует научные статьи, но не всё: книги, наборы данных и часть
// региональных журналов сидят в других реестрах. Без проверки по системе Handle
// настоящая работа оттуда выглядела бы выдуманной и была бы УДАЛЕНА — проверка
// на выдумки сама породила бы потерю достоверного источника.
describe("DOI из другого реестра", () => {
  const OTHER = "10.5281/zenodo.1234567";

  beforeEach(() => {
    clearCitationCache();
    vi.stubGlobal("fetch", async (url) => {
      const u = String(url);
      if (u.includes("api.crossref.org")) return { ok: false, status: 404 };
      if (u.includes("doi.org/api/handles")) {
        return { ok: true, json: async () => ({ responseCode: 1 }) };
      }
      return { ok: false, status: 404 };
    });
  });

  it("не удаляет работу, которой нет в Crossref, но DOI существует", async () => {
    const res = await verifyAndAnnotate(
      ref(1, "Ivanov I.", "Some dataset or book chapter", OTHER),
    );

    expect(res.replaced).toBe(0);
    expect(res.text).toContain("Some dataset or book chapter");
    expect(res.text).toMatch(/сверьте вручную/);
  });

  it("удаляет только то, чего нет нигде", async () => {
    vi.stubGlobal("fetch", async (url) => {
      if (String(url).includes("doi.org/api/handles")) {
        return { ok: true, json: async () => ({ responseCode: 100 }) };
      }
      return { ok: false, status: 404 };
    });

    const res = await verifyAndAnnotate(
      ref(1, "Ivanov I.", "Completely invented work", "10.9999/nonexistent.1"),
    );

    expect(res.replaced).toBe(1);
    expect(res.text).toMatch(/Источник удалён/);
  });

  it("при недоступной системе Handle не удаляет ничего", async () => {
    vi.stubGlobal("fetch", async (url) => {
      if (String(url).includes("doi.org/api/handles")) throw new Error("down");
      return { ok: false, status: 404 };
    });

    const res = await verifyAndAnnotate(
      ref(1, "Ivanov I.", "Maybe real work", "10.1234/unknown.1"),
    );

    expect(res.replaced).toBe(0);
    expect(res.unchecked).toBe(1);
  });
});
