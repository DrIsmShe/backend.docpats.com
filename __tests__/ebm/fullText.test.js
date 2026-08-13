// __tests__/ebm/fullText.test.js
//
// Полные тексты из собственного архива для находок PubMed.
//
// Ошибка здесь опаснее обычной: врач откроет «полный текст» под правильным
// заголовком и будет читать ЧУЖУЮ работу, не зная об этом. Поэтому проверяется
// не только то, что совпадение находится, но и что оно не находится там, где
// его быть не должно.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import mongoose from "mongoose";

import {
  findFullTexts,
  attachFullTexts,
} from "../../modules/ebm/services/fullText.service.js";

// Архив живёт в отдельной базе, к которой тесты не подключаются. Подменяем
// доступ к ней, оставляя нашу логику сопоставления настоящей.
let archive = [];
let lastQuery = null;

function mockArchive() {
  vi.spyOn(mongoose.connection, "getClient").mockReturnValue({
    db: () => ({
      collection: () => ({
        find: (query) => {
          lastQuery = query;
          return {
            project: () => ({ toArray: async () => archive }),
            toArray: async () => archive,
          };
        },
      }),
    }),
  });
}

const LONG_TEXT = "т".repeat(20000);

beforeEach(() => {
  archive = [];
  lastQuery = null;
  mockArchive();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("поиск полного текста в архиве", () => {
  it("находит работу по DOI независимо от регистра", async () => {
    // DOI регистронезависим по стандарту, но в базах хранится как пришёл:
    // PubMed может отдать 10.1371/JOURNAL.PONE.1, а у нас лежит в нижнем.
    archive = [
      { doi: "10.1371/journal.pone.1", slug: "study-1", content: LONG_TEXT },
    ];

    const found = await findFullTexts([{ doi: "10.1371/JOURNAL.PONE.1" }]);

    expect(found.get("10.1371/journal.pone.1")).toMatchObject({
      slug: "study-1",
    });
  });

  it("находит по PMID, когда DOI нет", async () => {
    archive = [{ pmid: "12345678", slug: "old-trial", content: LONG_TEXT }];

    const found = await findFullTexts([{ pmid: "12345678" }]);

    expect(found.get("12345678").slug).toBe("old-trial");
  });

  it("не считает полным текстом аннотацию", async () => {
    // 800 знаков — это аннотация. Врач, кликнув «читать целиком», не получит
    // больше, чем уже видит, и решит, что система его обманула.
    archive = [
      { doi: "10.1/short", slug: "abstract-only", content: "к".repeat(800) },
    ];

    const found = await findFullTexts([{ doi: "10.1/short" }]);

    expect(found.size).toBe(0);
  });

  it("не ходит в архив, когда идентификаторов нет вовсе", async () => {
    const found = await findFullTexts([{ title: "Работа без DOI и PMID" }]);

    expect(found.size).toBe(0);
    expect(lastQuery).toBeNull();
  });

  it("спрашивает только опубликованные материалы", async () => {
    archive = [{ doi: "10.1/x", slug: "s", content: LONG_TEXT }];

    await findFullTexts([{ doi: "10.1/x" }]);

    // Скрытые материалы — отозванные работы, платные обрывки — читать нельзя.
    expect(lastQuery.status).toBe("published");
  });
});

describe("подстановка ссылок в выдачу", () => {
  it("проставляет ссылку только тем работам, что есть у нас", async () => {
    archive = [
      { doi: "10.1371/found", slug: "we-have-it", content: LONG_TEXT },
    ];

    const result = await attachFullTexts([
      { pmid: "1", doi: "10.1371/found", title: "Есть у нас" },
      { pmid: "2", doi: "10.1371/missing", title: "Нет у нас" },
    ]);

    expect(result[0].fullTextUrl).toBe("/public/news/we-have-it");
    expect(result[0].fullTextLength).toBe(20000);
    expect(result[1].fullTextUrl).toBeUndefined();
  });

  it("не подменяет данные, пришедшие из PubMed", async () => {
    archive = [
      {
        doi: "10.1371/found",
        slug: "we-have-it",
        content: LONG_TEXT,
        // В архиве заголовок может быть переведён или обрезан — он НЕ должен
        // попасть в карточку вместо настоящего названия из PubMed.
        title: "Заголовок из архива",
      },
    ];

    const original = {
      pmid: "1",
      doi: "10.1371/found",
      title: "Настоящее название из PubMed",
      journal: "The Lancet",
      year: 2024,
    };

    const [result] = await attachFullTexts([original]);

    expect(result.title).toBe("Настоящее название из PubMed");
    expect(result.journal).toBe("The Lancet");
    expect(result.year).toBe(2024);
  });

  it("не связывает работы, у которых идентификаторы разные", async () => {
    // Главная защита: совпадение только по DOI или PMID, никогда по названию.
    // Иначе врач откроет чужую статью под правильным заголовком.
    archive = [
      { doi: "10.1371/other", slug: "another-study", content: LONG_TEXT },
    ];

    const [result] = await attachFullTexts([
      { pmid: "999", doi: "10.1371/mine", title: "Моя работа" },
    ]);

    expect(result.fullTextUrl).toBeUndefined();
  });

  it("переживает недоступность архива, не роняя поиск", async () => {
    // Архив в другой базе. Если она недоступна, врач должен получить выдачу
    // PubMed без ссылок — а не ошибку вместо доказательств.
    vi.spyOn(mongoose.connection, "getClient").mockImplementation(() => {
      throw new Error("connection lost");
    });

    const items = [{ pmid: "1", doi: "10.1/x", title: "Работа" }];
    const result = await attachFullTexts(items);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Работа");
    expect(result[0].fullTextUrl).toBeUndefined();
  });

  it("не трогает пустой список", async () => {
    expect(await attachFullTexts([])).toEqual([]);
    expect(lastQuery).toBeNull();
  });
});
