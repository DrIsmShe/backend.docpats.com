// __tests__/education/programLazyTranslation.test.js
//
// ДОГОНЯЮЩИЙ ПЕРЕВОД НАЗВАНИЯ ТЕСТА.
//
// Перевод запускается при публикации, но тесты, опубликованные ДО появления
// этой возможности, догонять приходилось скриптом руками. Ровно этот ручной
// шаг и оказался местом, где всё ломалось: врач видел русский заголовок в
// азербайджанском интерфейсе, а причина была не в коде, а в невыполненной
// команде. Теперь каталог заказывает недостающий перевод сам.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock(
  "../../modules/education/education-catalog/services/programTranslator.js",
  () => ({ translateProgramContent: vi.fn(), MODEL: "test-model" }),
);

const { translateProgramContent } = await import(
  "../../modules/education/education-catalog/services/programTranslator.js"
);
const { listPrograms, createProgram } = await import(
  "../../modules/education/education-catalog/services/program.service.js"
);
const { default: ExamProgram } = await import(
  "../../modules/education/education-catalog/models/examProgram.model.js"
);

let n = 0;
async function makeProgram(patch = {}) {
  n += 1;
  return createProgram({
    code: `lazy-${Date.now().toString(36)}-${n}`,
    title: patch.title ?? `Тест ${n}`,
    country: "INT",
    region: "international",
    examType: "cme",
    status: "published",
    ...patch,
  });
}

/**
 * Планировщик работает через setImmediate и по пути динамически импортирует
 * модель вопросов (resolveProgramSourceLang). Первый импорт заметно дольше
 * остальных, поэтому не ждём фиксированный срок, а опрашиваем до появления
 * вызова — иначе тест зелёный только со второго прогона.
 */
async function flush(expectCall = true) {
  for (let i = 0; i < 40; i += 1) {
    if (expectCall && translateProgramContent.mock.calls.length > 0) break;
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeEach(async () => {
  // Автоперевод выключен по умолчанию — язык на витрине это рубрика каталога,
  // и переводить нечего. Здесь проверяется именно включённый режим.
  process.env.EDUCATION_AUTO_TRANSLATE = "on";
  vi.clearAllMocks();
  await ExamProgram.deleteMany({});
  translateProgramContent.mockResolvedValue([
    { lang: "az", title: "Tərcümə", description: "" },
  ]);
});

describe("догоняющий перевод", () => {
  it("при выключенном автопереводе не заказывается вовсе", async () => {
    process.env.EDUCATION_AUTO_TRANSLATE = "off";
    await makeProgram();

    await listPrograms({ lang: "az" });
    await flush(false);

    expect(translateProgramContent).not.toHaveBeenCalled();
  });

  it("тест без переводов переводится при открытии каталога", async () => {
    const p = await makeProgram({ title: "Прионные болезни" });

    await listPrograms({ lang: "az" });
    await flush();

    expect(translateProgramContent).toHaveBeenCalledTimes(1);
    const fresh = await ExamProgram.findById(p._id).lean();
    expect(fresh.translations.map((t) => t.lang)).toEqual(["az"]);
  });

  it("уже переведённый тест модель не трогает", async () => {
    await makeProgram({
      translations: [{ lang: "az", title: "Prion xəstəlikləri" }],
    });

    await listPrograms({ lang: "az" });
    await flush(false);

    expect(translateProgramContent).not.toHaveBeenCalled();
  });

  it("черновик не переводим — его ещё переименуют", async () => {
    await makeProgram({ status: "draft" });

    // scope=all, иначе черновик и не попадёт в выдачу.
    await listPrograms({ scope: "all", lang: "az" });
    await flush(false);

    expect(translateProgramContent).not.toHaveBeenCalled();
  });

  it("повторное открытие каталога не заказывает перевод заново", async () => {
    // Иначе отказ модели превращался бы в вызов на каждое открытие витрины.
    translateProgramContent.mockResolvedValue([]);
    await makeProgram();

    await listPrograms({ lang: "az" });
    await flush();
    await listPrograms({ lang: "az" });
    await flush();

    expect(translateProgramContent).toHaveBeenCalledTimes(1);
  });

  it("без языка запроса ничего не заказываем", async () => {
    await makeProgram();

    await listPrograms({});
    await flush(false);

    expect(translateProgramContent).not.toHaveBeenCalled();
  });
});
