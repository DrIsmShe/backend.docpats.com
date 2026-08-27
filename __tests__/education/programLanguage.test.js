// __tests__/education/programLanguage.test.js
//
// ЯЗЫК ТЕСТА В КАТАЛОГЕ — по наличию вопросов, а заголовок берётся из
// перевода.
//
// Здесь была ровно обратная договорённость: тест отдавался по ОДНОМУ
// основному языку (primaryLang), даже если вопросы существовали на всех
// пяти. Причина была не в языке, а в заголовке: у теста не было перевода
// названия, и врач, выбравший English, получал карточку «Типология личности
// по Карлу Юнгу» — вопросы английские, а список нечитаем. Пришпилить тест к
// одному языку было дешевле, чем показывать нечитаемое.
//
// Теперь название и описание переводятся вместе с вопросами
// (education-catalog/services/programTranslator.js), и сервис отдаёт их на
// языке врача. Обходной путь стал вредом: переведённый тест по-прежнему
// показывался ровно на одном языке, а азербайджанский тест, лежащий в
// русской рубрике, вообще пропадал из каталога.
//
// primaryLang остался — но означает теперь язык ОРИГИНАЛА: от него считается,
// что переводить и к чему откатываться, когда перевода нет.

import { describe, it, expect, beforeEach } from "vitest";

const { listPrograms, createProgram, updateProgram, localizeProgram } =
  await import(
    "../../modules/education/education-catalog/services/program.service.js"
  );
const { default: ExamProgram } = await import(
  "../../modules/education/education-catalog/models/examProgram.model.js"
);

let n = 0;
async function makeProgram(patch = {}) {
  n += 1;
  const doc = await createProgram({
    code: `p-${Date.now().toString(36)}-${n}`,
    title: patch.title ?? `Тест ${n}`,
    country: "INT",
    region: "international",
    examType: "cme",
    status: "published",
    ...patch,
  });
  return doc;
}

const titles = (list) => list.map((p) => p.title).sort();

beforeEach(async () => {
  await ExamProgram.deleteMany({});
});

describe("фильтр каталога по языку", () => {
  it("переведённый тест виден на каждом языке, где есть вопросы", async () => {
    await makeProgram({
      title: "Типология личности по Юнгу",
      languages: ["ru", "en", "az", "tr", "ar"],
      primaryLang: "ru",
    });

    for (const lang of ["ru", "en", "az", "tr", "ar"]) {
      const found = await listPrograms({ language: lang });
      expect(found, lang).toHaveLength(1);
    }
  });

  it("на языке, которого у теста нет, он не показывается", async () => {
    await makeProgram({ title: "Только по-русски", languages: ["ru"] });

    expect(await listPrograms({ language: "ru" })).toHaveLength(1);
    // Вопросов на азербайджанском нет — показывать нечего, даже если
    // название переведено.
    expect(await listPrograms({ language: "az" })).toHaveLength(0);
  });

  it("primaryLang больше не сужает выдачу — он только язык оригинала", async () => {
    const p = await makeProgram({
      title: "Məntiqin gücü",
      languages: ["ru", "az"],
    });

    expect(await listPrograms({ language: "ru" })).toHaveLength(1);

    await updateProgram(p._id, { primaryLang: "az" });

    // Раньше эта разметка убирала тест из русской выдачи. Вопросы на русском
    // у него есть — значит русскоязычному врачу он доступен.
    expect(await listPrograms({ language: "ru" })).toHaveLength(1);
    expect(titles(await listPrograms({ language: "az" }))).toEqual([
      "Məntiqin gücü",
    ]);
  });

  it("без фильтра по языку видны все", async () => {
    await makeProgram({ languages: ["ru"], primaryLang: "ru" });
    await makeProgram({ languages: ["az"], primaryLang: "az" });

    expect(await listPrograms({})).toHaveLength(2);
  });
});

describe("заголовок на языке врача", () => {
  const translated = {
    title: "Прионные болезни",
    languages: ["ru", "az"],
    primaryLang: "ru",
    description: "Базовый уровень",
    translations: [
      {
        lang: "az",
        title: "Prion xəstəlikləri",
        description: "Baza səviyyəsi",
      },
    ],
  };

  it("витрина отдаёт перевод, если он есть", async () => {
    await makeProgram(translated);

    const az = await listPrograms({ language: "az", lang: "az" });
    expect(titles(az)).toEqual(["Prion xəstəlikləri"]);
    expect(az[0].description).toBe("Baza səviyyəsi");
  });

  it("перевода нет — отдаём оригинал, а не пустое место", async () => {
    await makeProgram(translated);

    // Турецкого перевода у теста нет.
    const tr = await listPrograms({ language: "ru", lang: "tr" });
    expect(titles(tr)).toEqual(["Прионные болезни"]);
  });

  it("админка (scope=all) всегда получает оригинал", async () => {
    await makeProgram({ ...translated, status: "draft" });

    // Иначе переименование в админке сохранило бы перевод поверх оригинала.
    const admin = await listPrograms({ scope: "all", lang: "az" });
    expect(titles(admin)).toEqual(["Прионные болезни"]);
  });

  it("localizeProgram не трогает тест на его же языке", async () => {
    const program = {
      title: "Прионные болезни",
      primaryLang: "ru",
      languages: ["ru", "az"],
      translations: [{ lang: "ru", title: "НЕ ДОЛЖНО ПРИМЕНИТЬСЯ" }],
    };
    expect(localizeProgram(program, "ru").title).toBe("Прионные болезни");
  });
});
