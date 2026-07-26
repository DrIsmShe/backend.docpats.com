// __tests__/radiology/attemptPolicy.test.js
//
// Правила попытки: что идёт в зачёт, когда открывается следующая зачётная,
// сколько времени даётся. Чистые функции — проверяются без базы.
//
// Самый важный тест здесь — «слот не восстанавливается, если попытку
// бросили»: отсчёт 24 часов идёт от НАЧАЛА зачётной попытки. Считай мы от
// сдачи, зачёт можно было бы отменять — начал, увидел трудный кейс, не сдал,
// и попытка как будто не тратилась.

import { describe, it, expect } from "vitest";
import {
  decideCounted,
  timeLimitFor,
  xpFactorFor,
  isExpired,
  secondsLeft,
  normalizeMode,
  COOLDOWN_MS,
  REPEAT_XP_FACTOR,
  DEFAULT_TIME_LIMIT_SEC,
} from "../../modules/radiology/radiology-attempts/services/attemptPolicy.js";

const NOW = new Date("2026-07-26T12:00:00Z");

describe("зачёт или тренировка", () => {
  it("тренировка никогда не в зачёт", () => {
    const d = decideCounted({ mode: "learn", now: NOW });
    expect(d.counted).toBe(false);
    expect(d.reason).toBe("training");
    expect(d.isFirstCounted).toBe(false);
  });

  it("первая зачётная попытка по кейсу — в зачёт, и она формирует статистику", () => {
    const d = decideCounted({ mode: "exam", hadCounted: false, now: NOW });
    expect(d).toMatchObject({ counted: true, reason: "first", isFirstCounted: true });
  });

  it("повторный зачёт раньше 24 часов — не в зачёт, с датой открытия", () => {
    const start = new Date(NOW.getTime() - 3 * 60 * 60 * 1000); // 3 часа назад
    const d = decideCounted({ mode: "exam", hadCounted: true, lastCountedStart: start, now: NOW });
    expect(d.counted).toBe(false);
    expect(d.reason).toBe("cooldown");
    expect(d.nextCountedAt.getTime()).toBe(start.getTime() + COOLDOWN_MS);
  });

  it("через 24 часа зачёт снова доступен, но уже как повтор", () => {
    const start = new Date(NOW.getTime() - COOLDOWN_MS);
    const d = decideCounted({ mode: "exam", hadCounted: true, lastCountedStart: start, now: NOW });
    expect(d).toMatchObject({ counted: true, reason: "repeat", isFirstCounted: false });
  });

  it("отсчёт от НАЧАЛА попытки: брошенная зачётная не возвращает слот", () => {
    // Попытку начали 2 часа назад и не сдали (submittedAt нет вообще).
    const start = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
    const d = decideCounted({ mode: "exam", hadCounted: true, lastCountedStart: start, now: NOW });
    expect(d.counted).toBe(false);
  });

  it("неизвестный режим считается тренировкой, а не зачётом", () => {
    expect(normalizeMode("hack")).toBe("learn");
    expect(decideCounted({ mode: "hack", now: NOW }).counted).toBe(false);
  });
});

describe("лимит времени", () => {
  it("в тренировке лимита нет", () => {
    expect(timeLimitFor({ station: "labs", mode: "learn" })).toBeNull();
  });

  it("в зачёте берётся значение станции", () => {
    expect(timeLimitFor({ station: "labs", mode: "exam" })).toBe(DEFAULT_TIME_LIMIT_SEC.labs);
    expect(timeLimitFor({ station: "vp", mode: "exam" })).toBe(DEFAULT_TIME_LIMIT_SEC.vp);
  });

  it("лимит кейса важнее значения станции", () => {
    expect(timeLimitFor({ station: "labs", mode: "exam", caseTimeLimitSec: 120 })).toBe(120);
  });

  it("дедлайн в прошлом — попытка просрочена", () => {
    expect(isExpired({ deadlineAt: new Date(NOW.getTime() - 1000) }, NOW)).toBe(true);
    expect(isExpired({ deadlineAt: new Date(NOW.getTime() + 1000) }, NOW)).toBe(false);
  });

  it("без дедлайна попытка не может просрочиться (тренировка)", () => {
    expect(isExpired({ deadlineAt: null }, NOW)).toBe(false);
    expect(secondsLeft({ deadlineAt: null }, NOW)).toBeNull();
  });

  it("остаток времени не уходит в минус", () => {
    expect(secondsLeft({ deadlineAt: new Date(NOW.getTime() + 90_000) }, NOW)).toBe(90);
    expect(secondsLeft({ deadlineAt: new Date(NOW.getTime() - 90_000) }, NOW)).toBe(0);
  });
});

describe("множитель XP", () => {
  it("тренировка не даёт XP", () => {
    expect(xpFactorFor({ counted: false, isFirstCounted: false })).toBe(0);
  });

  it("первая зачётная — полный XP", () => {
    expect(xpFactorFor({ counted: true, isFirstCounted: true })).toBe(1);
  });

  it("повторная зачётная — доля: улучшать выгодно, фармить почти нет", () => {
    expect(xpFactorFor({ counted: true, isFirstCounted: false })).toBe(REPEAT_XP_FACTOR);
    expect(REPEAT_XP_FACTOR).toBeLessThan(1);
  });
});
