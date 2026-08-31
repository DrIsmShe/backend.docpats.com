// __tests__/education/categoryTranslations.test.js
//
// Переводы рубрик каталога.
//
// ЗАЧЕМ РУБРИКЕ ЯЗЫК. Его не было вовсе: одно поле name, набранное админом на
// своём языке. Азербайджанский врач видел в каталоге «Психология», «Научные»
// и «Psixoloqiya» вперемешку — первые две непереведённые, третья заведена
// руками отдельной категорией. Выглядело как сломанный фильтр по языку, хотя
// сломано было одно: рубрика не знала, на каком языке написана.
//
// Модель замокана: качество перевода — не предмет этих тестов. Здесь важно
// другое — что отдаётся врачу и что происходит с переводом при переименовании.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { translateMock } = vi.hoisted(() => ({ translateMock: vi.fn() }));

vi.mock(
  "../../modules/education/education-categories/services/categoryTranslator.js",
  () => ({ translateCategoryContent: translateMock }),
);

const { createCategory, updateCategory, listCategoriesTree } = await import(
  "../../modules/education/education-categories/services/category.service.js"
);
const { default: ExamCategory } = await import(
  "../../modules/education/education-categories/models/examCategory.model.js"
);

/**
 * Дождаться фонового перевода: он идёт через setImmediate и наружу промис
 * не отдаёт.
 *
 * Фиксированной паузы не хватало. В одиночку файл проходил, а в полном
 * прогоне запись в базу не успевала за 30 мс, и тест падал через раз —
 * на пустых переводах. Поэтому ждём не время, а результат: пока перевод
 * не окажется в рубрике. Без условия — прежняя короткая пауза, её хватает
 * там, где проверяется как раз ОТСУТСТВИЕ перевода.
 */
const settle = async (until) => {
  const deadline = Date.now() + 3000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 10));
    if (!until || (await until())) return;
    if (Date.now() > deadline) return;
  }
};

/** Условие «у рубрики с таким именем перевод уже сохранён». */
const translated = (name) => async () => {
  const doc = await ExamCategory.findOne({ name }).lean();
  return Boolean(doc?.translations?.length);
};

const find = (tree, name) => tree.find((c) => c.name === name);

beforeEach(() => {
  // Автоперевод выключен по умолчанию: имена рубрик — решение админа. Здесь
  // проверяется именно включённый режим (EDUCATION_AUTO_TRANSLATE=on).
  process.env.EDUCATION_AUTO_TRANSLATE = "on";
  translateMock.mockReset();
  translateMock.mockResolvedValue([
    { lang: "az", name: "Psixologiya", description: "" },
    { lang: "en", name: "Psychology", description: "" },
  ]);
});

describe("выключенный автоперевод", () => {
  it("не заказывает перевод и не подменяет имя готовым", async () => {
    // Рубрику заводим при включённом режиме, чтобы перевод в базе появился.
    await createCategory({ name: "Психология", lang: "ru" });
    await settle(translated("Психология"));

    process.env.EDUCATION_AUTO_TRANSLATE = "off";
    translateMock.mockClear();

    const tree = await listCategoriesTree({ lang: "az" });
    expect(tree.map((c) => c.name)).toContain("Психология");

    await createCategory({ name: "Научные", lang: "ru" });
    await settle();
    expect(translateMock).not.toHaveBeenCalled();
  });
});

describe("перевод рубрики", () => {
  it("создание запускает перевод и сохраняет его в рубрике", async () => {
    const cat = await createCategory({ name: "Психология", lang: "ru" });
    await settle(translated("Психология"));

    const fresh = await ExamCategory.findById(cat._id).lean();
    expect(fresh.lang).toBe("ru");
    expect(fresh.translations.map((t) => t.lang).sort()).toEqual(["az", "en"]);
    expect(translateMock).toHaveBeenCalledTimes(1);
    // Переводим на ВСЕ остальные языки, а не на один.
    expect(translateMock.mock.calls[0][0].targetLangs).toHaveLength(4);
  });

  it("врач получает имя рубрики на своём языке", async () => {
    await createCategory({ name: "Психология", lang: "ru" });
    await settle(translated("Психология"));

    const az = await listCategoriesTree({ lang: "az" });
    expect(find(az, "Psixologiya")).toBeTruthy();

    const en = await listCategoriesTree({ lang: "en" });
    expect(find(en, "Psychology")).toBeTruthy();
  });

  it("нет перевода на нужный язык — отдаём оригинал, а не пустоту", async () => {
    await createCategory({ name: "Психология", lang: "ru" });
    await settle(translated("Психология"));

    // Турецкого в моке нет.
    const tr = await listCategoriesTree({ lang: "tr" });
    expect(find(tr, "Психология")).toBeTruthy();
  });

  it("язык оригинала не подменяется собственным переводом", async () => {
    await createCategory({ name: "Психология", lang: "ru" });
    await settle(translated("Психология"));

    const ru = await listCategoriesTree({ lang: "ru" });
    expect(find(ru, "Психология")).toBeTruthy();
  });

  it("переименование стирает старые переводы СРАЗУ и заказывает новые", async () => {
    const cat = await createCategory({ name: "Психология", lang: "ru" });
    await settle(translated("Психология"));

    translateMock.mockResolvedValue([
      { lang: "az", name: "Kardiologiya", description: "" },
    ]);
    await updateCategory(cat._id, { name: "Кардиология" });

    // ДО того, как фоновый перевод отработал: старого «Psixologiya» уже нет.
    // Устаревший перевод хуже оригинала — он вводит в заблуждение, а
    // оригинал просто читается на чужом языке.
    const mid = await ExamCategory.findById(cat._id).lean();
    expect(mid.translations).toHaveLength(0);

    await settle(async () => {
      const doc = await ExamCategory.findById(cat._id).lean();
      return doc?.translations?.[0]?.name === "Kardiologiya";
    });
    const after = await ExamCategory.findById(cat._id).lean();
    expect(after.translations[0].name).toBe("Kardiologiya");
  });

  it("правка порядка или иконки перевод не трогает", async () => {
    const cat = await createCategory({ name: "Психология", lang: "ru" });
    await settle(translated("Психология"));
    translateMock.mockClear();

    await updateCategory(cat._id, { order: 5 });
    await settle();

    expect(translateMock).not.toHaveBeenCalled();
    const after = await ExamCategory.findById(cat._id).lean();
    expect(after.translations).toHaveLength(2);
  });

  it("сбой перевода не мешает создать рубрику", async () => {
    translateMock.mockRejectedValue(new Error("модель недоступна"));

    const cat = await createCategory({ name: "Научные", lang: "ru" });
    await settle();

    const fresh = await ExamCategory.findById(cat._id).lean();
    expect(fresh.name).toBe("Научные");
    expect(fresh.translations).toHaveLength(0);
  });
});
