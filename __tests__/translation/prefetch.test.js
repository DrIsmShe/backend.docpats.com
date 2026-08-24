// Догоняющий перевод опубликованных материалов.
//
// Прежняя версия брала ТОП-10 по просмотрам, и лента выходила наполовину
// переведённой: популярные карточки на языке пользователя, остальные — на
// языке оригинала, вперемешку в одной сетке. Догнать хвост было нечем —
// список ленты зовёт getTranslationIfExists, который перевод не планирует.
//
// Здесь проверяется главное свойство новой версии: ОХВАТ полный, а
// ограничен ТЕМП. Материал вне десятки по просмотрам обязан попасть в
// очередь, пусть и не с первого прохода.

import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import Article from "../../common/models/Articles/articles.js";
import ContentTranslation from "../../common/models/Articles/contentTranslation.js";

// Очередь подменяем: проверяем, ЧТО планируется, а не работу BullMQ с Redis.
//
// worker.enabled переключает, доводится ли задача до перевода. С ним тест
// повторяет жизнь: выполненная задача убирает пару из недостающих, и догон
// сходится. Без него имитируется неработающий воркер — на этом проверяется,
// что застрявший материал не запирает остальные.
const enqueued = [];
const worker = { enabled: true };

vi.mock("../../modules/translation/translation.service.js", () => ({
  enqueueTranslation: vi.fn(async ({ entity, entityType, targetLanguage }) => {
    enqueued.push(`${entityType}:${entity._id}:${targetLanguage}`);
    if (!worker.enabled) return;
    const { default: Model } = await import(
      "../../common/models/Articles/contentTranslation.js"
    );
    await Model.create({
      entityId: entity._id,
      entityType,
      language: targetLanguage,
      title: `${entity.title} [${targetLanguage}]`,
      content: entity.content,
      translatedFrom: entity.originalLanguage || "ru",
      sourceVersion: entity.translationVersion || 0,
      isStale: false,
    });
  }),
}));

const { prefetchTranslations } = await import(
  "../../modules/translation/translation.prefetch.js"
);

async function makeArticle(overrides = {}) {
  return Article.create({
    title: "Тестовая статья",
    content: "Текст статьи для перевода",
    abstract: "Аннотация",
    authorId: new mongoose.Types.ObjectId(),
    isPublished: true,
    originalLanguage: "ru",
    translationVersion: 0,
    ...overrides,
  });
}

beforeEach(() => {
  enqueued.length = 0;
  worker.enabled = true;
});

describe("догоняющий перевод", () => {
  it("планирует перевод на все языки, кроме языка оригинала", async () => {
    const a = await makeArticle();

    await prefetchTranslations();

    // ru — язык оригинала, переводить нечего.
    expect(enqueued).toHaveLength(4);
    for (const lang of ["en", "az", "tr", "ar"]) {
      expect(enqueued).toContain(`Article:${a._id}:${lang}`);
    }
    expect(enqueued).not.toContain(`Article:${a._id}:ru`);
  });

  it("существующий перевод повторно не планируется", async () => {
    const a = await makeArticle();
    await ContentTranslation.create({
      entityId: a._id,
      entityType: "Article",
      language: "en",
      title: "Test article",
      content: "Article text",
      translatedFrom: "ru",
      sourceVersion: 0,
      isStale: false,
    });

    await prefetchTranslations();

    expect(enqueued).not.toContain(`Article:${a._id}:en`);
    expect(enqueued).toHaveLength(3);
  });

  it("перевод с ПРОШЛОЙ редакции не считается существующим", async () => {
    // Именно так решает findTranslation, отдавая перевод посетителю: не
    // совпала sourceVersion — перевода нет. Карточка иначе осталась бы на
    // языке оригинала навсегда после первой же правки текста.
    const a = await makeArticle({ translationVersion: 2 });
    await ContentTranslation.create({
      entityId: a._id,
      entityType: "Article",
      language: "en",
      title: "Stale",
      content: "Stale",
      translatedFrom: "ru",
      sourceVersion: 1,
      isStale: false,
    });

    await prefetchTranslations();

    expect(enqueued).toContain(`Article:${a._id}:en`);
  });

  it("непопулярный материал тоже переводится — охват не ограничен просмотрами", async () => {
    // Ровно тот случай, на котором ломалась прежняя версия: 12 материалов,
    // а переводились только 10 самых просматриваемых.
    const created = [];
    for (let i = 0; i < 12; i += 1) {
      created.push(await makeArticle({ title: `Статья ${i}`, views: i }));
    }

    // Проходы идут до схождения — как в жизни, где крон ходит каждые
    // 10 минут, а выполненные задачи убирают пары из списка недостающих.
    // Потолок на число итераций — чтобы тест падал, а не висел, если
    // сходимость сломается.
    for (let pass = 0; pass < 10; pass += 1) {
      const { missing } = await prefetchTranslations();
      if (!missing) break;
    }

    const leastPopular = created[0];
    expect(enqueued.some((k) => k.startsWith(`Article:${leastPopular._id}:`))).toBe(
      true,
    );
  });

  it("материал, на котором перевод не выходит, не запирает остальные", async () => {
    // Список недостающих пересобирается каждый проход, поэтому при выборе
    // строго «первые N» вечно падающий материал занимал бы голову партии
    // всегда и хвост не планировался бы никогда.
    const many = [];
    for (let i = 0; i < 30; i += 1) {
      many.push(await makeArticle({ title: `Статья ${i}` }));
    }

    // Переводы не появляются вовсе — имитируем воркер, который не работает.
    worker.enabled = false;
    await prefetchTranslations();
    const firstPass = new Set(enqueued);
    enqueued.length = 0;
    await prefetchTranslations();
    const secondPass = new Set(enqueued);

    // Второй проход обязан достать хоть что-то, чего не было в первом.
    const fresh = [...secondPass].filter((k) => !firstPass.has(k));
    expect(fresh.length).toBeGreaterThan(0);
  });

  it("за один проход планируется не больше партии", async () => {
    for (let i = 0; i < 12; i += 1) {
      await makeArticle({ title: `Статья ${i}` });
    }

    await prefetchTranslations();

    // 48 недостающих, партия по умолчанию 40: темп ограничен, охват — нет.
    expect(enqueued.length).toBeLessThanOrEqual(40);
    expect(enqueued.length).toBeGreaterThan(0);
  });

  it("черновик не переводится", async () => {
    await makeArticle({ isPublished: false });

    await prefetchTranslations();

    expect(enqueued).toHaveLength(0);
  });
});
