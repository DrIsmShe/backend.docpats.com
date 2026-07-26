// __tests__/radiology/attemptCounted.test.js
//
// Зачёт против тренировки — сквозная проверка на станции «Анализы» (правила
// общие для трёх станций, движок один: attemptPolicy + caseStats + game).
//
// Что здесь по-настоящему важно и почему:
//
//   • Тренировка не даёт XP и не портит статистику кейса. Раньше XP шёл за
//     каждую сдачу, и один кейс, пройденный десять раз после разбора,
//     накручивал ранг; средний балл кейса при этом уезжал вверх, и авторы
//     не могли доверять цифре сложности.
//   • Средний балл кейса считается ТОЛЬКО по первым зачётным попыткам.
//   • Повторный зачёт по тому же кейсу раньше 24 часов не считается.
//   • Незакрытая попытка продолжается, а не заводится заново, — иначе
//     перезагрузка страницы обнуляла бы таймер зачёта.
//   • Сдача после дедлайна принимается, но зачётность снимается: иначе
//     лимит времени был бы декоративным.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import LabCase from "../../modules/radiology/labs-station/models/labCase.model.js";
import LabAttempt from "../../modules/radiology/labs-station/models/labAttempt.model.js";
import RadiologyPlayer from "../../modules/radiology/game/radiologyPlayer.model.js";
import RadiologyReviewItem from "../../modules/radiology/review/models/radiologyReviewItem.model.js";
import {
  startLabAttempt,
  submitLabAttempt,
  getLabPolicy,
} from "../../modules/radiology/labs-station/lab.service.js";
import { COOLDOWN_MS } from "../../modules/radiology/radiology-attempts/services/attemptPolicy.js";

const userId = new mongoose.Types.ObjectId();

async function makeCase(overrides = {}) {
  return LabCase.create({
    title: "Железодефицитная анемия",
    clinicalContext: "Женщина 34 лет, утомляемость",
    panel: [
      { key: "hgb", name: "Гемоглобин", value: "88", unit: "г/л", refRange: "120–150" },
      { key: "ferritin", name: "Ферритин", value: "4", unit: "мкг/л", refRange: "15–150" },
      { key: "plt", name: "Тромбоциты", value: "290", unit: "10⁹/л", refRange: "150–400" },
    ],
    significantAbnormal: ["hgb", "ferritin"],
    impression: {
      correctText: "Картина железодефицитной анемии",
      diagnosisKeys: ["железодефицитная анемия"],
      diagnosisSynonyms: ["жда"],
    },
    source: { kind: "original" },
    status: "published",
    ...overrides,
  });
}

// Полностью верный ответ — чтобы отличать «не засчитали» от «ответил плохо».
function goodAnswer() {
  return {
    flags: ["hgb", "ferritin"],
    diagnosisKeys: ["железодефицитная анемия"],
    diagnosisText: "Железодефицитная анемия средней степени",
    impressionText: "Снижен гемоглобин и ферритин, картина дефицита железа",
  };
}

let labCase;
beforeEach(async () => {
  labCase = await makeCase();
});

describe("тренировочная попытка", () => {
  it("не в зачёт, без XP и без влияния на средний балл кейса", async () => {
    const { attempt } = await startLabAttempt(labCase._id, userId, "learn");
    expect(attempt.counted).toBe(false);
    expect(attempt.countedReason).toBe("training");
    expect(attempt.timeLimitSec).toBeNull();
    expect(attempt.deadlineAt).toBeNull();

    const { attempt: done, game } = await submitLabAttempt(attempt._id, userId, goodAnswer());
    expect(done.score.total).toBeGreaterThan(0.85); // ответ верный
    expect(game.pointsAwarded).toBe(0);
    expect(game.xpReason).toBe("training");

    const fresh = await LabCase.findById(labCase._id).lean();
    expect(fresh.stats.attempts).toBe(1); // трафик виден
    expect(fresh.stats.countedAttempts).toBe(0); // а измерение — нет
    expect(fresh.stats.avgScore).toBe(0);

    const player = await RadiologyPlayer.findOne({ userId }).lean();
    expect(player.xp).toBe(0);
    expect(player.casesCompleted).toBe(0);
    expect(player.streak).toBe(1); // регулярность занятий тренировка держит
  });

  it("не двигает очередь повторения даже при плохом результате", async () => {
    const { attempt } = await startLabAttempt(labCase._id, userId, "learn");
    await submitLabAttempt(attempt._id, userId, { flags: [], diagnosisText: "не знаю" });
    expect(await RadiologyReviewItem.countDocuments({ userId })).toBe(0);
  });
});

describe("зачётная попытка", () => {
  it("первая по кейсу: XP, уникальный кейс и средний балл кейса", async () => {
    const { attempt } = await startLabAttempt(labCase._id, userId, "exam");
    expect(attempt.counted).toBe(true);
    expect(attempt.isFirstCounted).toBe(true);
    expect(attempt.countedReason).toBe("first");
    expect(attempt.timeLimitSec).toBeGreaterThan(0);
    expect(attempt.deadlineAt).toBeTruthy();

    const { attempt: done, game } = await submitLabAttempt(attempt._id, userId, goodAnswer());
    expect(game.pointsAwarded).toBeGreaterThan(0);
    expect(game.xpReason).toBe("first_counted");
    expect(done.durationMs).toBeGreaterThanOrEqual(0);

    const fresh = await LabCase.findById(labCase._id).lean();
    expect(fresh.stats.countedAttempts).toBe(1);
    expect(fresh.stats.avgScore).toBeCloseTo(done.score.total, 5);
    expect(fresh.stats.avgDurationMs).toBeGreaterThanOrEqual(0);

    const player = await RadiologyPlayer.findOne({ userId }).lean();
    expect(player.casesCompleted).toBe(1);
  });

  it("слабый результат ставит кейс в очередь повторения", async () => {
    const { attempt } = await startLabAttempt(labCase._id, userId, "exam");
    await submitLabAttempt(attempt._id, userId, { flags: ["plt"], diagnosisText: "норма" });
    const item = await RadiologyReviewItem.findOne({ userId, station: "labs" }).lean();
    expect(item).toBeTruthy();
    expect(item.box).toBe(1);
  });

  it("собирает сигналы добросовестности, но балл ими не меняет", async () => {
    const { attempt } = await startLabAttempt(labCase._id, userId, "exam");
    const { attempt: done } = await submitLabAttempt(attempt._id, userId, {
      ...goodAnswer(),
      integrity: { pasteEvents: 1, pastedChars: 900, hiddenMs: 5000, focusLosses: 2 },
    });
    expect(done.integrity.flags).toContain("paste");
    expect(done.score.total).toBeGreaterThan(0.85); // балл как у честной сдачи
  });
});

describe("повтор по тому же кейсу", () => {
  it("сразу после зачёта — только тренировка, XP не начисляется", async () => {
    const first = await startLabAttempt(labCase._id, userId, "exam");
    await submitLabAttempt(first.attempt._id, userId, goodAnswer());

    const policy = await getLabPolicy(labCase._id, userId, "exam");
    expect(policy.counted).toBe(false);
    expect(policy.countedReason).toBe("cooldown");
    expect(policy.nextCountedAt).toBeTruthy();
    expect(policy.attemptNo).toBe(2);
    expect(policy.lastCountedScore).toBeGreaterThan(0.85);

    const second = await startLabAttempt(labCase._id, userId, "exam");
    expect(second.attempt.counted).toBe(false);
    expect(second.attempt.countedReason).toBe("cooldown");

    const { game } = await submitLabAttempt(second.attempt._id, userId, goodAnswer());
    expect(game.pointsAwarded).toBe(0);

    const fresh = await LabCase.findById(labCase._id).lean();
    expect(fresh.stats.attempts).toBe(2); // сдач две
    expect(fresh.stats.countedAttempts).toBe(1); // а в измерение попала одна
  });

  it("через 24 часа зачёт открывается снова и даёт частичный XP", async () => {
    const first = await startLabAttempt(labCase._id, userId, "exam");
    await submitLabAttempt(first.attempt._id, userId, goodAnswer());
    const xpAfterFirst = (await RadiologyPlayer.findOne({ userId }).lean()).xp;

    // Отодвигаем первую попытку в прошлое — как будто прошли сутки.
    await LabAttempt.updateOne(
      { _id: first.attempt._id },
      { $set: { startedAt: new Date(Date.now() - COOLDOWN_MS - 1000) } },
    );

    const second = await startLabAttempt(labCase._id, userId, "exam");
    expect(second.attempt.counted).toBe(true);
    expect(second.attempt.countedReason).toBe("repeat");
    expect(second.attempt.isFirstCounted).toBe(false);

    const { game } = await submitLabAttempt(second.attempt._id, userId, goodAnswer());
    expect(game.pointsAwarded).toBeGreaterThan(0);
    expect(game.pointsAwarded).toBeLessThan(xpAfterFirst); // повтор дешевле
    expect(game.xpReason).toBe("repeat_counted");

    const player = await RadiologyPlayer.findOne({ userId }).lean();
    expect(player.casesCompleted).toBe(1); // кейс тот же — уникальных по-прежнему один

    const fresh = await LabCase.findById(labCase._id).lean();
    expect(fresh.stats.countedAttempts).toBe(1); // средний балл кейса не тронут
  });

  it("счётчик уникальных кейсов растёт от разных кейсов, а не от повторов", async () => {
    const other = await makeCase({ title: "Второй кейс" });
    for (const c of [labCase, other]) {
      const { attempt } = await startLabAttempt(c._id, userId, "exam");
      await submitLabAttempt(attempt._id, userId, goodAnswer());
    }
    const player = await RadiologyPlayer.findOne({ userId }).lean();
    expect(player.casesCompleted).toBe(2);
  });
});

describe("незакрытая и просроченная попытка", () => {
  it("повторный старт продолжает ту же попытку, а не начинает новую", async () => {
    const first = await startLabAttempt(labCase._id, userId, "exam");
    const again = await startLabAttempt(labCase._id, userId, "exam");
    expect(again.resumed).toBe(true);
    expect(String(again.attempt._id)).toBe(String(first.attempt._id));
    expect(await LabAttempt.countDocuments({ userId })).toBe(1);
    expect(again.secondsLeft).toBeGreaterThan(0);
  });

  it("сдача после дедлайна принимается, но зачётность снимается", async () => {
    const { attempt } = await startLabAttempt(labCase._id, userId, "exam");
    await LabAttempt.updateOne(
      { _id: attempt._id },
      { $set: { deadlineAt: new Date(Date.now() - 5000) } },
    );

    const { attempt: done } = await submitLabAttempt(attempt._id, userId, goodAnswer());
    expect(done.lateSubmit).toBe(true);
    expect(done.counted).toBe(false);
    expect(done.countedReason).toBe("late");
    expect(done.score.total).toBeGreaterThan(0.85); // ответ не потерян

    const fresh = await LabCase.findById(labCase._id).lean();
    expect(fresh.stats.countedAttempts).toBe(0);
  });

  it("брошенная просроченная попытка помечается expired и слот не возвращает", async () => {
    const first = await startLabAttempt(labCase._id, userId, "exam");
    await LabAttempt.updateOne(
      { _id: first.attempt._id },
      { $set: { deadlineAt: new Date(Date.now() - 5000) } },
    );

    const second = await startLabAttempt(labCase._id, userId, "exam");
    expect(second.resumed).toBe(false);
    const old = await LabAttempt.findById(first.attempt._id).lean();
    expect(old.status).toBe("expired");
    // Слот зачёта уже потрачен первой попыткой — новая идёт вне зачёта.
    expect(second.attempt.counted).toBe(false);
    expect(second.attempt.countedReason).toBe("cooldown");
  });

  it("просроченную брошенную попытку сдать нельзя", async () => {
    const first = await startLabAttempt(labCase._id, userId, "exam");
    await LabAttempt.updateOne(
      { _id: first.attempt._id },
      { $set: { deadlineAt: new Date(Date.now() - 5000) } },
    );
    await startLabAttempt(labCase._id, userId, "exam"); // помечает первую expired

    await expect(submitLabAttempt(first.attempt._id, userId, goodAnswer())).rejects.toThrow(
      /просрочена/,
    );
  });
});
