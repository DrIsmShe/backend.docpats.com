// __tests__/education/attemptLanguage.test.js
//
// ЯЗЫК СОБРАННОЙ ПОПЫТКИ — язык врача, а не первый язык теста.
//
// Вопросы банка переводятся на все языки при публикации (education-
// translation), а сборка сессии брала languages[0]. Порядок в languages задаёт
// EXAM_LANGUAGES, где "ru" первым, — поэтому как только у теста появлялся
// русский перевод, азербайджанский врач, открыв азербайджанский тест, получал
// РУССКИЕ вопросы. Перевод в базе есть, а выдача его не спрашивала.
//
// Правило: явный lang запроса → язык интерфейса врача → язык оригинала.
// Языка, которого у теста нет, не подставляем: пустая попытка хуже попытки на
// чужом языке.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import ExamProgram from "../../modules/education/education-catalog/models/examProgram.model.js";
import ExamItem from "../../modules/education/education-items/models/examItem.model.js";
import User from "../../common/models/Auth/users.js";
import { startAttempt } from "../../modules/education/education-attempts/services/attempt.service.js";

const oid = () => new mongoose.Types.ObjectId();

async function makeLearner() {
  const suffix = new mongoose.Types.ObjectId().toString();
  return User.create({
    emailEncrypted: `attempt-lang-${suffix}@example.com`,
    firstNameEncrypted: "Тест",
    lastNameEncrypted: "Учащийся",
    emailHash: "placeholder",
    firstNameHash: "placeholder",
    lastNameHash: "placeholder",
    username: `attempt-lang-${suffix}`,
    password: "hashed-password-placeholder",
    dateOfBirth: new Date("1990-01-01"),
    bio: "test",
    agreement: true,
    role: "doctor",
    subscriptionPlan: "doctor_pro",
  });
}

async function seedItems(programId, lang, count) {
  const docs = [];
  for (let i = 0; i < count; i++) {
    docs.push({
      programId,
      topicCode: "bio",
      lang,
      stem: `[${lang}] Вопрос №${i}`,
      options: [
        { key: "A", text: "верный", explanation: "верно" },
        { key: "B", text: "неверный", explanation: "неверно" },
      ],
      correctKeys: ["A"],
      explanation: "разбор",
      source: { kind: "original" },
      status: "published",
      reviewedBy: oid(),
    });
  }
  return ExamItem.insertMany(docs);
}

let program;
let learner;

beforeEach(async () => {
  program = await ExamProgram.create({
    code: `lang-${Date.now().toString(36)}`,
    title: "Прионные болезни",
    country: "INT",
    region: "international",
    examType: "cme",
    defaultQuestionCount: 4,
    blueprint: [{ code: "bio", title: "Биология", weightPercent: 100 }],
    // Порядок ровно тот, что расставляет recountPublishedItems.
    languages: ["ru", "az"],
    primaryLang: "az",
    status: "published",
  });
  await seedItems(program._id, "ru", 4);
  await seedItems(program._id, "az", 4);
  learner = await makeLearner();
});

describe("язык попытки", () => {
  it("берётся язык врача, а не первый язык теста", async () => {
    const attempt = await startAttempt({
      userId: learner._id,
      programId: program._id,
      requestLang: "az",
    });
    expect(attempt.lang).toBe("az");
  });

  it("явный lang запроса главнее языка интерфейса", async () => {
    const attempt = await startAttempt({
      userId: learner._id,
      programId: program._id,
      lang: "ru",
      requestLang: "az",
    });
    expect(attempt.lang).toBe("ru");
  });

  it("языка, которого у теста нет, не подставляем", async () => {
    const attempt = await startAttempt({
      userId: learner._id,
      programId: program._id,
      requestLang: "tr",
    });
    // Турецких вопросов нет — откатываемся на первый доступный.
    expect(attempt.lang).toBe("ru");
  });

  it("вопросы приходят на выбранном языке", async () => {
    const attempt = await startAttempt({
      userId: learner._id,
      programId: program._id,
      requestLang: "az",
    });
    const items = await ExamItem.find({
      _id: { $in: attempt.questions.map((q) => q.itemId) },
    })
      .select("lang")
      .lean();
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.lang === "az")).toBe(true);
  });
});
