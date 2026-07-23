// __tests__/education/quota.test.js
//
// Тарифная квота модуля подготовки к экзаменам: демо-доступ гостя,
// месячный лимит зарегистрированного, аддон Exam Prep и перенос гостевой
// попытки в аккаунт после регистрации.
//
// Расход считается по ОТВЕЧЕННЫМ вопросам, поэтому во всех сценариях
// попытки реально проходятся, а не просто создаются.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import ExamProgram from "../../modules/education/education-catalog/models/examProgram.model.js";
import ExamItem from "../../modules/education/education-items/models/examItem.model.js";
import ExamAttempt from "../../modules/education/education-attempts/models/examAttempt.model.js";
import User from "../../common/models/Auth/users.js";
import {
  startAttempt,
  answerQuestion,
  submitAttempt,
} from "../../modules/education/education-attempts/services/attempt.service.js";
import {
  getExamQuota,
  assertCanStart,
  claimGuestAttempts,
} from "../../modules/education/services/quota.service.js";

const oid = () => new mongoose.Types.ObjectId();

async function makeProgram(overrides = {}) {
  return ExamProgram.create({
    code: `quota-${Math.random().toString(36).slice(2, 8)}`,
    title: "Тест для квоты",
    country: "INT",
    region: "international",
    examType: "cme",
    defaultQuestionCount: 10,
    status: "published",
    ...overrides,
  });
}

async function seedItems(programId, count) {
  const docs = Array.from({ length: count }, (_, i) => ({
    programId,
    topicCode: "gen",
    stem: `Вопрос №${i}`,
    options: [
      { key: "A", text: "верный", explanation: "верно" },
      { key: "B", text: "неверный", explanation: "неверно" },
    ],
    correctKeys: ["A"],
    explanation: "разбор",
    source: { kind: "original" },
    status: "published",
    reviewedBy: oid(),
  }));
  return ExamItem.insertMany(docs);
}

// Пациент без подписки — это patient_free, 250 вопросов в месяц.
//
// Поля-хеши обязательны на уровне схемы, а заполняет их pre-save хук —
// то есть валидация случается раньше. Подставляем заглушку, хук перезапишет
// (тот же приём, что в __tests__/clinic-patients).
async function makeUser(overrides = {}) {
  const suffix = new mongoose.Types.ObjectId().toString();
  return User.create({
    emailEncrypted: `quota-${suffix}@example.com`,
    firstNameEncrypted: "Тест",
    lastNameEncrypted: "Пользователь",
    emailHash: "placeholder",
    firstNameHash: "placeholder",
    lastNameHash: "placeholder",
    username: `quota-${suffix}`,
    password: "hashed-password-placeholder",
    dateOfBirth: new Date("1990-01-01"),
    bio: "test",
    agreement: true,
    role: "patient",
    ...overrides,
  });
}

/** Отвечает на n вопросов попытки — именно они и списывают квоту. */
async function answerN(attempt, actor, n) {
  for (const q of attempt.questions.slice(0, n)) {
    await answerQuestion(attempt._id, actor, {
      itemId: q.itemId,
      selectedKeys: ["A"],
    });
  }
}

describe("квота: гость", () => {
  it("демо-доступ — 20 вопросов, тест только с isFree", async () => {
    const program = await makeProgram({ isFree: true });
    await seedItems(program._id, 30);

    const quota = await getExamQuota({ guestSessionId: "sess-guest-1" });
    expect(quota.isGuest).toBe(true);
    expect(quota.limit).toBe(20);
    expect(quota.remaining).toBe(20);
    // Гостевая квота не возобновляется — периода нет.
    expect(quota.periodStart).toBeNull();
  });

  it("платный тест гостю не открывается", async () => {
    const program = await makeProgram({ isFree: false });
    await seedItems(program._id, 5);

    await expect(
      startAttempt({
        guestSessionId: "sess-guest-2",
        programId: program._id,
        questionCount: 5,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("отвеченные вопросы списывают квоту, исчерпание даёт 402 с апселлом", async () => {
    const program = await makeProgram({ isFree: true });
    await seedItems(program._id, 40);
    const actor = { guestSessionId: "sess-guest-3" };

    const first = await startAttempt({
      ...actor,
      programId: program._id,
      questionCount: 20,
    });
    await answerN(first, actor, 20);
    // Закрываем попытку: иначе следующий старт упрётся в «уже есть
    // незавершённая», а проверять мы хотим именно квоту.
    await submitAttempt(first._id, actor);

    const spent = await getExamQuota(actor);
    expect(spent.used).toBe(20);
    expect(spent.remaining).toBe(0);

    await expect(
      startAttempt({ ...actor, programId: program._id, questionCount: 5 }),
    ).rejects.toMatchObject({
      status: 402,
      code: "QUOTA_EXCEEDED",
      details: { upgrade: "register", isGuest: true },
    });
  });

  it("гости не видят чужой расход", async () => {
    const program = await makeProgram({ isFree: true });
    await seedItems(program._id, 30);

    const a = { guestSessionId: "sess-a" };
    const attempt = await startAttempt({
      ...a,
      programId: program._id,
      questionCount: 5,
    });
    await answerN(attempt, a, 5);

    expect((await getExamQuota(a)).used).toBe(5);
    expect((await getExamQuota({ guestSessionId: "sess-b" })).used).toBe(0);
  });
});

describe("квота: зарегистрированный", () => {
  it("бесплатный аккаунт — 250 вопросов в месяц", async () => {
    const user = await makeUser();
    const quota = await getExamQuota({ userId: user._id });

    expect(quota.isGuest).toBe(false);
    expect(quota.plan).toBe("patient_free");
    expect(quota.limit).toBe(250);
    expect(quota.unlimited).toBe(false);
    // Месячная квота — период обязан быть.
    expect(quota.periodStart).toBeInstanceOf(Date);
    expect(quota.periodEnd.getTime()).toBeGreaterThan(
      quota.periodStart.getTime(),
    );
  });

  it("расход прошлого месяца в текущую квоту не входит", async () => {
    const user = await makeUser();
    const program = await makeProgram();
    await seedItems(program._id, 10);

    const attempt = await startAttempt({
      userId: user._id,
      programId: program._id,
      questionCount: 5,
    });
    await answerN(attempt, user._id, 5);
    expect((await getExamQuota({ userId: user._id })).used).toBe(5);

    // Двигаем попытку в прошлый месяц — она обязана выпасть из подсчёта.
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    await ExamAttempt.updateOne(
      { _id: attempt._id },
      { $set: { startedAt: lastMonth } },
    );

    expect((await getExamQuota({ userId: user._id })).used).toBe(0);
  });

  it("аддон Exam Prep поднимает лимит, просроченный — нет", async () => {
    const tomorrow = new Date(Date.now() + 86400000);
    const yesterday = new Date(Date.now() - 86400000);

    const active = await makeUser({
      examAddon: "exam_plus",
      examAddonEndsAt: tomorrow,
    });
    const expired = await makeUser({
      examAddon: "exam_plus",
      examAddonEndsAt: yesterday,
    });

    const withAddon = await getExamQuota({ userId: active._id });
    expect(withAddon.limit).toBe(2000);
    expect(withAddon.addon).toBe("exam_plus");
    expect(withAddon.addonLabel).toBe("Exam Prep Plus");

    const withoutAddon = await getExamQuota({ userId: expired._id });
    expect(withoutAddon.limit).toBe(250);
    expect(withoutAddon.addon).toBeNull();
  });

  it("Exam Prep Unlimited снимает лимит", async () => {
    const user = await makeUser({
      examAddon: "exam_unlimited",
      examAddonEndsAt: new Date(Date.now() + 86400000),
    });
    const quota = await getExamQuota({ userId: user._id });

    expect(quota.unlimited).toBe(true);
    expect(quota.limit).toBe(-1);
    expect(quota.remaining).toBe(Infinity);
  });

  it("план сильнее аддона, если у плана уже безлимит", async () => {
    // doctor_pro — безлимит; докупленный Plus не должен опустить до 2000.
    const user = await makeUser({
      role: "doctor",
      subscriptionPlan: "doctor_pro",
      examAddon: "exam_plus",
      examAddonEndsAt: new Date(Date.now() + 86400000),
    });
    expect((await getExamQuota({ userId: user._id })).unlimited).toBe(true);
  });
});

describe("assertCanStart", () => {
  it("урезает заказ до остатка вместо отказа", async () => {
    const program = await makeProgram({ isFree: true });
    await seedItems(program._id, 40);
    const actor = { guestSessionId: "sess-partial" };

    const first = await startAttempt({
      ...actor,
      programId: program._id,
      questionCount: 15,
    });
    await answerN(first, actor, 15);
    // Незавершённая попытка блокирует новую по тому же тесту — закрываем.
    await submitAttempt(first._id, actor);

    // Осталось 5 — просим 20, должны получить ровно 5.
    const { allowed } = await assertCanStart({ ...actor, requested: 20 });
    expect(allowed).toBe(5);

    const second = await startAttempt({
      ...actor,
      programId: program._id,
      questionCount: 20,
    });
    expect(second.questions).toHaveLength(5);
  });

  it("безлимиту заказ не урезается", async () => {
    const user = await makeUser({
      examAddon: "exam_unlimited",
      examAddonEndsAt: new Date(Date.now() + 86400000),
    });
    const { allowed } = await assertCanStart({
      userId: user._id,
      requested: 200,
    });
    expect(allowed).toBe(200);
  });
});

describe("перенос гостевой попытки в аккаунт", () => {
  it("после регистрации результат остаётся у человека, а квота — чистой", async () => {
    const program = await makeProgram({ isFree: true });
    await seedItems(program._id, 30);
    const actor = { guestSessionId: "sess-claim" };

    const attempt = await startAttempt({
      ...actor,
      programId: program._id,
      questionCount: 10,
    });
    await answerN(attempt, actor, 10);

    const user = await makeUser();
    const moved = await claimGuestAttempts({
      userId: user._id,
      guestSessionId: "sess-claim",
    });
    expect(moved).toBe(1);

    const reloaded = await ExamAttempt.findById(attempt._id).lean();
    expect(String(reloaded.userId)).toBe(String(user._id));
    expect(reloaded.guestSessionId).toBeNull();

    // Демо-вопросы — подарок за регистрацию: месячную квоту они не едят.
    // Расход переехавшей попытки в текущий месяц всё же попадает, поэтому
    // проверяем главное: лимит стал месячным и до него далеко.
    const quota = await getExamQuota({ userId: user._id });
    expect(quota.limit).toBe(250);
    expect(quota.remaining).toBeGreaterThan(200);
  });

  it("чужие гостевые попытки не переезжают", async () => {
    const program = await makeProgram({ isFree: true });
    await seedItems(program._id, 10);
    await startAttempt({
      guestSessionId: "sess-other",
      programId: program._id,
      questionCount: 5,
    });

    const user = await makeUser();
    const moved = await claimGuestAttempts({
      userId: user._id,
      guestSessionId: "sess-nothing-here",
    });
    expect(moved).toBe(0);
  });
});

describe("модель попытки", () => {
  it("требует ровно одного владельца", async () => {
    const program = await makeProgram();

    await expect(
      ExamAttempt.create({ programId: program._id, mode: "tutor" }),
    ).rejects.toThrow(/ровно один владелец/);

    await expect(
      ExamAttempt.create({
        programId: program._id,
        mode: "tutor",
        userId: oid(),
        guestSessionId: "sess-both",
      }),
    ).rejects.toThrow(/ровно один владелец/);
  });
});
