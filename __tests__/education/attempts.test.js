// __tests__/education/attempts.test.js
//
// Прохождение и скоринг: разнарядка по blueprint, проверка ответа,
// подсчёт результата и готовность к экзамену.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import ExamProgram from "../../modules/education/education-catalog/models/examProgram.model.js";
import ExamItem from "../../modules/education/education-items/models/examItem.model.js";
import {
  buildBlueprintPlan,
  isAnswerCorrect,
  startAttempt,
  answerQuestion,
  submitAttempt,
  getAttemptForLearner,
  getReadiness,
} from "../../modules/education/education-attempts/services/attempt.service.js";

const oid = () => new mongoose.Types.ObjectId();

async function makeProgram(overrides = {}) {
  return ExamProgram.create({
    code: "sa-smle-test",
    title: "SMLE (тест)",
    country: "SA",
    region: "mena",
    examType: "licensing",
    passingScorePercent: 60,
    defaultQuestionCount: 4,
    blueprint: [
      { code: "cardio", title: "Кардиология", weightPercent: 50 },
      { code: "neuro", title: "Неврология", weightPercent: 50 },
    ],
    status: "published",
    ...overrides,
  });
}

// Опубликованные вопросы создаём напрямую: редакторский цикл проверяется
// в items.test.js, здесь он только мешал бы.
async function seedItems(programId, topicCode, count) {
  const docs = [];
  for (let i = 0; i < count; i++) {
    docs.push({
      programId,
      topicCode,
      stem: `Вопрос ${topicCode} №${i}`,
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

describe("buildBlueprintPlan", () => {
  it("раздаёт вопросы пропорционально весам, сумма точно равна заказу", () => {
    const plan = buildBlueprintPlan(
      [
        { code: "a", title: "A", weightPercent: 50 },
        { code: "b", title: "B", weightPercent: 30 },
        { code: "c", title: "C", weightPercent: 20 },
      ],
      10,
    );
    expect(plan.map((p) => p.count)).toEqual([5, 3, 2]);
    expect(plan.reduce((s, p) => s + p.count, 0)).toBe(10);
  });

  it("не теряет вопросы на дробных остатках", () => {
    // 3 темы по 33.33% от 10 вопросов: наивное округление вниз дало бы 9.
    const plan = buildBlueprintPlan(
      [
        { code: "a", title: "A", weightPercent: 33.34 },
        { code: "b", title: "B", weightPercent: 33.33 },
        { code: "c", title: "C", weightPercent: 33.33 },
      ],
      10,
    );
    expect(plan.reduce((s, p) => s + p.count, 0)).toBe(10);
  });

  it("игнорирует подтемы — вес считается только по верхнему уровню", () => {
    const plan = buildBlueprintPlan(
      [
        { code: "a", title: "A", weightPercent: 100 },
        { code: "a.1", title: "A1", parentCode: "a", weightPercent: 50 },
      ],
      6,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].count).toBe(6);
  });
});

describe("isAnswerCorrect", () => {
  it("не зависит от порядка вариантов", () => {
    expect(isAnswerCorrect(["B", "A"], ["A", "B"])).toBe(true);
  });

  it("частичный ответ не засчитывается", () => {
    expect(isAnswerCorrect(["A"], ["A", "B"])).toBe(false);
  });

  it("лишний выбранный вариант не засчитывается", () => {
    expect(isAnswerCorrect(["A", "B", "C"], ["A", "B"])).toBe(false);
  });

  it("пустой ответ неверен", () => {
    expect(isAnswerCorrect([], ["A"])).toBe(false);
  });
});

describe("прохождение попытки", () => {
  let program;
  let userId;

  beforeEach(async () => {
    program = await makeProgram();
    userId = oid();
    await seedItems(program._id, "cardio", 4);
    await seedItems(program._id, "neuro", 4);
  });

  it("mock собирает состав по blueprint", async () => {
    const attempt = await startAttempt({
      userId,
      programId: program._id,
      mode: "mock",
      questionCount: 4,
    });

    const counts = attempt.questions.reduce((acc, q) => {
      acc[q.topicCode] = (acc[q.topicCode] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ cardio: 2, neuro: 2 });
    expect(attempt.expiresAt).toBeTruthy(); // mock таймированный
  });

  it("не выдаёт правильные ответы до ответа учащегося", async () => {
    const attempt = await startAttempt({
      userId,
      programId: program._id,
      mode: "timed",
      questionCount: 2,
    });
    const view = await getAttemptForLearner(attempt._id, userId);

    for (const question of view.questions) {
      expect(question.correctKeys).toBeUndefined();
      expect(question.explanation).toBeUndefined();
      expect(question.options.every((o) => !("explanation" in o))).toBe(true);
    }
  });

  it("режим tutor возвращает разбор сразу после ответа", async () => {
    const attempt = await startAttempt({
      userId,
      programId: program._id,
      mode: "tutor",
      questionCount: 2,
    });

    const result = await answerQuestion(attempt._id, userId, {
      itemId: attempt.questions[0].itemId,
      selectedKeys: ["B"],
    });

    expect(result.isCorrect).toBe(false);
    expect(result.correctKeys).toEqual(["A"]);
    expect(result.explanation).toBe("разбор");
  });

  it("в режиме tutor переответить нельзя — разбор уже показан", async () => {
    const attempt = await startAttempt({
      userId,
      programId: program._id,
      mode: "tutor",
      questionCount: 2,
    });
    const itemId = attempt.questions[0].itemId;

    await answerQuestion(attempt._id, userId, { itemId, selectedKeys: ["B"] });
    await expect(
      answerQuestion(attempt._id, userId, { itemId, selectedKeys: ["A"] }),
    ).rejects.toThrow(/already answered/i);
  });

  it("чужую попытку открыть нельзя", async () => {
    const attempt = await startAttempt({
      userId,
      programId: program._id,
      mode: "timed",
      questionCount: 2,
    });
    await expect(getAttemptForLearner(attempt._id, oid())).rejects.toThrow(
      /another user/i,
    );
  });

  it("вторая незавершённая попытка по той же программе блокируется", async () => {
    await startAttempt({ userId, programId: program._id, mode: "timed" });
    await expect(
      startAttempt({ userId, programId: program._id, mode: "timed" }),
    ).rejects.toThrow(/already have an attempt in progress/i);
  });

  it("неотвеченный вопрос засчитывается как неверный", async () => {
    const attempt = await startAttempt({
      userId,
      programId: program._id,
      mode: "timed",
      questionCount: 4,
    });

    // Отвечаем верно только на один вопрос из четырёх.
    await answerQuestion(attempt._id, userId, {
      itemId: attempt.questions[0].itemId,
      selectedKeys: ["A"],
      timeSpentMs: 5000,
    });

    const submitted = await submitAttempt(attempt._id, userId);
    expect(submitted.score.total).toBe(4);
    expect(submitted.score.correct).toBe(1);
    expect(submitted.score.percent).toBe(25);
    expect(submitted.score.passed).toBe(false);
  });

  it("считает результат по темам и обновляет статистику вопросов", async () => {
    const attempt = await startAttempt({
      userId,
      programId: program._id,
      mode: "mock",
      questionCount: 4,
    });

    for (const question of attempt.questions) {
      await answerQuestion(attempt._id, userId, {
        itemId: question.itemId,
        selectedKeys: question.topicCode === "cardio" ? ["A"] : ["B"],
        timeSpentMs: 3000,
      });
    }

    const submitted = await submitAttempt(attempt._id, userId);
    const cardio = submitted.score.byTopic.find((t) => t.topicCode === "cardio");
    const neuro = submitted.score.byTopic.find((t) => t.topicCode === "neuro");

    expect(cardio.percent).toBe(100);
    expect(cardio.title).toBe("Кардиология");
    expect(neuro.percent).toBe(0);
    expect(submitted.score.percent).toBe(50);

    // Статистика вопроса нужна для item analysis.
    const answered = await ExamItem.findById(attempt.questions[0].itemId).lean();
    expect(answered.stats.served).toBe(1);
  });

  it("обрезает завышенное время, присланное клиентом", async () => {
    const attempt = await startAttempt({
      userId,
      programId: program._id,
      mode: "timed",
      questionCount: 2,
    });

    await answerQuestion(attempt._id, userId, {
      itemId: attempt.questions[0].itemId,
      selectedKeys: ["A"],
      timeSpentMs: 99 * 60 * 60 * 1000, // «вкладка была открыта четверо суток»
    });

    const submitted = await submitAttempt(attempt._id, userId);
    expect(submitted.score.totalTimeMs).toBe(30 * 60 * 1000);
  });
});

describe("готовность к экзамену", () => {
  it("взвешивает темы так же, как настоящий экзамен", async () => {
    // Кардиология весит 80%, неврология 20%. Отвечаем идеально по
    // неврологии и полностью проваливаем кардиологию: невзвешенное
    // среднее дало бы 50%, взвешенное обязано дать 20%.
    const program = await makeProgram({
      code: "weighted-test",
      blueprint: [
        { code: "cardio", title: "Кардиология", weightPercent: 80 },
        { code: "neuro", title: "Неврология", weightPercent: 20 },
      ],
    });
    const userId = oid();
    await seedItems(program._id, "cardio", 5);
    await seedItems(program._id, "neuro", 5);

    const attempt = await startAttempt({
      userId,
      programId: program._id,
      mode: "mock",
      questionCount: 10,
    });
    for (const question of attempt.questions) {
      await answerQuestion(attempt._id, userId, {
        itemId: question.itemId,
        selectedKeys: question.topicCode === "neuro" ? ["A"] : ["B"],
      });
    }
    await submitAttempt(attempt._id, userId);

    const readiness = await getReadiness(userId, program._id);
    expect(readiness.readinessPercent).toBe(20);
    expect(readiness.weakestTopics).toContain("cardio");
  });

  it("темы без статистики помечаются как непроверенные", async () => {
    const program = await makeProgram({ code: "untested-test" });
    const readiness = await getReadiness(oid(), program._id);

    expect(readiness.topics).toHaveLength(2);
    expect(readiness.topics.every((t) => t.untested)).toBe(true);
    expect(readiness.coveragePercent).toBe(0);
  });
});
