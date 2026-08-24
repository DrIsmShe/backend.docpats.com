// Одна ветка переводов на всех потребителей.
//
// Перевод ищется по тройке (сущность, язык, sourceVersion) —
// translation.repository.js, findTranslation. Значит все, кто просит перевод,
// обязаны называть ОДНУ И ТУ ЖЕ версию, иначе каждый живёт в своей ветке.
//
// Именно это и происходило: лента (articlesAllController,
// articlesScientificAllController) передавала `translationVersion: 1`
// жёстко, а страница статьи и догоняющий перевод — настоящую версию
// документа (у новой статьи это 0). Следствия:
//   • переводы, сделанные для страницы статьи и кроном, лента не видела;
//   • лента заказывала свои, то есть каждый материал переводился дважды;
//   • до того, как лента оплатит свой перевод, карточка оставалась на языке
//     оригинала — вперемешку с уже переведёнными.
//
// Тест закрывает контракт на уровне сервиса: перевод, записанный с версией
// документа, обязан находиться по этой же версии, и НЕ находиться по чужой.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import Article from "../../common/models/Articles/articles.js";
import ContentTranslation from "../../common/models/Articles/contentTranslation.js";
import { getTranslationIfExists } from "../../modules/translation/translation.service.js";

async function makeArticle(overrides = {}) {
  return Article.create({
    title: "Оригинальный заголовок",
    content: "Текст статьи",
    authorId: new mongoose.Types.ObjectId(),
    isPublished: true,
    originalLanguage: "ru",
    translationVersion: 0,
    ...overrides,
  });
}

async function makeTranslation(article, { language, sourceVersion }) {
  return ContentTranslation.create({
    entityId: article._id,
    entityType: "Article",
    language,
    title: `Translated ${language} v${sourceVersion}`,
    content: "Translated body",
    translatedFrom: article.originalLanguage,
    sourceVersion,
    isStale: false,
  });
}

describe("ветка переводов", () => {
  it("перевод находится по ВЕРСИИ ДОКУМЕНТА", async () => {
    const article = await makeArticle({ translationVersion: 0 });
    await makeTranslation(article, { language: "az", sourceVersion: 0 });

    const found = await getTranslationIfExists({
      entity: article,
      entityType: "Article",
      targetLanguage: "az",
    });

    expect(found.isOriginal).toBe(false);
    expect(found.title).toBe("Translated az v0");
  });

  it("по ЧУЖОЙ версии тот же перевод не находится — это и была расщеплённая ветка", async () => {
    const article = await makeArticle({ translationVersion: 0 });
    await makeTranslation(article, { language: "az", sourceVersion: 0 });

    // Ровно то, что делала лента: спрашивала версию 1 у статьи версии 0.
    const found = await getTranslationIfExists({
      entity: { ...article.toObject(), translationVersion: 1 },
      entityType: "Article",
      targetLanguage: "az",
    });

    expect(found.isOriginal).toBe(true);
    expect(found.title).toBe("Оригинальный заголовок");
  });

  it("после правки статьи прежний перевод больше не отдаётся", async () => {
    // Версия для того и растёт: перевод старого текста показывать нельзя.
    const article = await makeArticle({ translationVersion: 3 });
    await makeTranslation(article, { language: "az", sourceVersion: 2 });

    const found = await getTranslationIfExists({
      entity: article,
      entityType: "Article",
      targetLanguage: "az",
    });

    expect(found.isOriginal).toBe(true);
  });

  it("устаревший перевод не отдаётся, даже если версия совпала", async () => {
    const article = await makeArticle({ translationVersion: 0 });
    const tr = await makeTranslation(article, {
      language: "az",
      sourceVersion: 0,
    });
    tr.isStale = true;
    await tr.save();

    const found = await getTranslationIfExists({
      entity: article,
      entityType: "Article",
      targetLanguage: "az",
    });

    expect(found.isOriginal).toBe(true);
  });
});
