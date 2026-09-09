// Лента статей отдаёт поля, без которых перевод не находится.
//
// ПОЧЕМУ ЭТО ТЕСТ, А НЕ КОММЕНТАРИЙ. Перевод хранится в ветке своей версии
// (translationVersion). В выборке ленты этого поля не было — приходило
// undefined, код честно подставлял 0, перевод версии 1 «не находился», и
// лента отдавала оригинал, ставя при каждом показе задание на перевод,
// который давно готов. Снаружи это выглядело так: статья открывается
// переведённой, а карточка в ленте — на языке оригинала.
//
// Ошибка невидима на глаз: страница работает, ошибок нет, деньги тратятся,
// перевод не показывается. Единственное, что её ловит, — проверка списка
// полей, потому что она проверяет причину, а не следствие.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const корень = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const ФАЙЛЫ = {
  "научные статьи":
    "modules/doctorsProfiles/controllers/articlesScientificAllController.js",
  "публикации врачей":
    "modules/doctorsProfiles/controllers/articlesAllController.js",
};

const прочитать = (путь) => readFileSync(join(корень, путь), "utf8");

describe("поля выборки в лентах статей", () => {
  for (const [имя, путь] of Object.entries(ФАЙЛЫ)) {
    it(`${имя}: берут ветку версии перевода`, () => {
      const код = прочитать(путь);
      const проекция = код.slice(код.indexOf("$project"));
      expect(проекция).toContain("translationVersion: 1");
    });

    it(`${имя}: берут язык оригинала, а не угадывают его`, () => {
      // Угадывание по тексту работает, но лишний раз ошибается на
      // терминологии: половина медицинской статьи — латынь.
      const код = прочитать(путь);
      const проекция = код.slice(код.indexOf("$project"));
      expect(проекция).toContain("originalLanguage: 1");
    });

    it(`${имя}: берут переводы названия рубрики`, () => {
      // Рубрика подписывает карточку; без title она остаётся на языке, на
      // котором её завели.
      const код = прочитать(путь);
      expect(код).toContain('title: "$categoryDoc.title"');
    });

    it(`${имя}: перевод запрашивается с версией статьи, а не с единицей`, () => {
      const код = прочитать(путь);
      expect(код).toContain("translationVersion: a.translationVersion || 0");
    });
  }
});
