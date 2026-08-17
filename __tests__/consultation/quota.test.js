// server/__tests__/consultation/quota.test.js
//
// Лимит AI-консультаций и эпикризов.
//
// Два дефекта, ради которых написан этот файл:
//
//   1. Эпикриз генерировался ДО проверки лимита. Человек сверх предела
//      ничего не получал, но каждый его запрос уходил в модель и стоил
//      денег — и повторять это можно было бесконечно.
//
//   2. Консультация списывалась только когда браузер присылал
//      isGreeting: true. Клиент, который флаг не шлёт, консультировался
//      без ограничений — лимит держался до первого человека, открывшего
//      вкладку разработчика.
//
// Оба проверяются здесь через контроллер, а не через сервис: дефекты
// жили именно в порядке вызовов внутри контроллера.

import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

// Модель мокаем: тест про учёт, а не про качество ответа. Заодно
// считаем обращения — в этом и суть первой проверки.
const aiCalls = { chat: 0, epicrisis: 0 };
let aiShouldFail = false;

vi.mock(
  "../../modules/consultation/consultation.service.js",
  async (importOriginal) => {
    const actual = await importOriginal();
    return {
      ...actual,
      chatWithClaude: vi.fn(async () => {
        aiCalls.chat += 1;
        if (aiShouldFail) throw new Error("модель недоступна");
        return "ответ модели";
      }),
      buildEpicrisis: vi.fn(async () => {
        aiCalls.epicrisis += 1;
        if (aiShouldFail) throw new Error("модель недоступна");
        return { summary: "эпикриз", specialistsNeeded: [] };
      }),
    };
  },
);

const { chat, epicrisis, sessionStatus } = await import(
  "../../modules/consultation/consultation.controller.js"
);
const { createTestDoctor } = await import("../helpers/createTestUser.js");
// Гостевые пределы читаются из .env, поэтому берём их оттуда же, а не
// вписываем числом: иначе тест ломается от правки переменной окружения,
// к учёту отношения не имеющей.
const GUEST_CONSULTATIONS =
  parseInt(process.env.CONSULTATION_GUEST_LIMIT, 10) || 3;
const GUEST_EPICRISES = parseInt(process.env.EPICRISIS_GUEST_LIMIT, 10) || 1;

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

/** Гость: лимиты у него маленькие, а значит достижимые в тесте. */
function guestReq(body) {
  return { session: {}, headers: { "x-guest-id": "guest-1" }, body, ip: "1.1.1.1" };
}

const USER_MSG = [{ role: "user", content: "болит голова" }];
const WITH_REPLY = [
  { role: "user", content: "болит голова" },
  { role: "assistant", content: "ответ модели" },
  { role: "user", content: "а ещё тошнит" },
];

describe("лимит консультаций", () => {
  beforeEach(() => {
    aiCalls.chat = 0;
    aiCalls.epicrisis = 0;
    aiShouldFail = false;
  });

  it("первое сообщение списывает консультацию даже без флага isGreeting", async () => {
    // Флаг присылает браузер. Если списание зависит только от него,
    // лимита нет вовсе.
    const res = mockRes();
    await chat(guestReq({ messages: USER_MSG }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.used).toBe(1);
  });

  it("продолжение переписки не списывает вторую консультацию", async () => {
    await chat(guestReq({ messages: USER_MSG }), mockRes());

    const res = mockRes();
    await chat(guestReq({ messages: WITH_REPLY }), res);

    expect(res.statusCode).toBe(200);
    // Счётчика в ответе нет — списания не было.
    expect(res.body.used).toBeUndefined();
  });

  it("исчерпанный лимит отдаёт 429 и НЕ обращается к модели", async () => {
    for (let i = 0; i < GUEST_CONSULTATIONS; i += 1) {
      await chat(guestReq({ messages: USER_MSG }), mockRes());
    }
    const callsAfterFirst = aiCalls.chat;

    const res = mockRes();
    await chat(guestReq({ messages: USER_MSG }), res);

    expect(res.statusCode).toBe(429);
    expect(res.body.error).toBe("SESSION_LIMIT");
    // Главное: отказ не должен стоить нам денег.
    expect(aiCalls.chat).toBe(callsAfterFirst);
  });

  it("сбой модели возвращает списанную консультацию", async () => {
    aiShouldFail = true;
    const failed = mockRes();
    await chat(guestReq({ messages: USER_MSG }), failed).catch(() => {});
    aiShouldFail = false;

    // Место вернулось — следующая попытка проходит.
    const res = mockRes();
    await chat(guestReq({ messages: USER_MSG }), res);
    expect(res.statusCode).toBe(200);
  });
});

describe("врач: лимит берётся из aiPatientConsultations", () => {
  // Врачебные планы поля aiConsultations не описывают вовсе. Пока код
  // читал именно его, врач получал 0 → запасные 7 из .env: на Pro вместо
  // обещанных 60, на Lite вместо обещанных 3. Ошибка была в обе стороны.
  it("Pro получает 60, а не запасные 7", async () => {
    const { user } = await createTestDoctor({
      subscriptionPlan: "doctor_pro",
      subscriptionEndsAt: new Date(Date.now() + 30 * 864e5),
    });

    const res = mockRes();
    await sessionStatus(
      { session: { userId: String(user._id) }, headers: {}, ip: "1.1.1.1" },
      res,
    );

    expect(res.body.consultations.max).toBe(60);
  });

  it("Lite получает 3, а не запасные 7", async () => {
    const { user } = await createTestDoctor({
      subscriptionPlan: "doctor_lite",
      subscriptionEndsAt: new Date(Date.now() + 30 * 864e5),
    });

    const res = mockRes();
    await sessionStatus(
      { session: { userId: String(user._id) }, headers: {}, ip: "1.1.1.1" },
      res,
    );

    expect(res.body.consultations.max).toBe(3);
  });
});

describe("лимит эпикризов", () => {
  beforeEach(() => {
    aiCalls.chat = 0;
    aiCalls.epicrisis = 0;
    aiShouldFail = false;
  });

  it("сверх лимита отказывает ДО генерации — отказ не должен стоить денег", async () => {
    for (let i = 0; i < GUEST_EPICRISES; i += 1) {
      await epicrisis(guestReq({ messages: USER_MSG }), mockRes());
    }
    const callsAfterFirst = aiCalls.epicrisis;

    const res = mockRes();
    await epicrisis(guestReq({ messages: USER_MSG }), res);

    expect(res.statusCode).toBe(429);
    expect(aiCalls.epicrisis).toBe(callsAfterFirst);
  });

  it("сбой генерации возвращает списанный эпикриз", async () => {
    aiShouldFail = true;
    const failed = mockRes();
    await epicrisis(guestReq({ messages: USER_MSG }), failed);
    expect(failed.statusCode).toBe(500);
    aiShouldFail = false;

    const res = mockRes();
    await epicrisis(guestReq({ messages: USER_MSG }), res);
    expect(res.statusCode).toBe(200);
  });
});
