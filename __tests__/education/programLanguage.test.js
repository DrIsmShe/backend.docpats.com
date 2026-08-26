// __tests__/education/programLanguage.test.js
//
// ЯЗЫК ТЕСТА В КАТАЛОГЕ — жёсткая привязка, а не «где есть вопросы».
//
// Врач выбирал в фильтре English и получал «Типологию личности по Карлу
// Юнгу» с русским заголовком. Фильтр при этом работал верно: languages —
// набор языков, на которых существуют ВОПРОСЫ, и у переведённого теста там
// честно все пять. Тест действительно доступен на английском. Но каталог
// отвечает на вопрос «что здесь есть на моём языке», а не «что я технически
// могу открыть», и по первому вопросу отвечает primaryLang, который ставит
// человек.
//
// Откат на languages для неразмеченных обязателен: без него старые тесты
// исчезли бы из каталога в тот же миг, как появилось поле.

import { describe, it, expect, beforeEach } from "vitest";

const { listPrograms, createProgram, updateProgram } = await import(
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
  it("тест отдаётся по ОСНОВНОМУ языку, а не по наличию вопросов", async () => {
    await makeProgram({
      title: "Типология личности по Юнгу",
      languages: ["ru", "en", "az", "tr", "ar"],
      primaryLang: "ru",
    });

    const ru = await listPrograms({ language: "ru" });
    expect(titles(ru)).toEqual(["Типология личности по Юнгу"]);

    // Вопросы на английском есть, но тест — русский. Это и было жалобой.
    const en = await listPrograms({ language: "en" });
    expect(en).toHaveLength(0);
  });

  it("неразмеченный тест находится по языкам своих вопросов", async () => {
    await makeProgram({
      title: "Старый тест",
      languages: ["az"],
      // primaryLang не проставлен — админ ещё не размечал.
    });

    const az = await listPrograms({ language: "az" });
    expect(titles(az)).toEqual(["Старый тест"]);
  });

  it("разметка перекрывает откат: тест уходит из старой выдачи", async () => {
    const p = await makeProgram({ title: "Məntiqin gücü", languages: ["ru", "az"] });

    // До разметки находится по обоим языкам.
    expect(await listPrograms({ language: "ru" })).toHaveLength(1);

    await updateProgram(p._id, { primaryLang: "az" });

    expect(await listPrograms({ language: "ru" })).toHaveLength(0);
    expect(titles(await listPrograms({ language: "az" }))).toEqual([
      "Məntiqin gücü",
    ]);
  });

  it("снятие разметки возвращает откат на languages", async () => {
    const p = await makeProgram({ languages: ["ru", "en"], primaryLang: "en" });

    expect(await listPrograms({ language: "ru" })).toHaveLength(0);

    await updateProgram(p._id, { primaryLang: null });

    expect(await listPrograms({ language: "ru" })).toHaveLength(1);
  });

  it("без фильтра по языку видны все", async () => {
    await makeProgram({ languages: ["ru"], primaryLang: "ru" });
    await makeProgram({ languages: ["az"], primaryLang: "az" });

    expect(await listPrograms({})).toHaveLength(2);
  });
});
