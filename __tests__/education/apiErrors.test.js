// __tests__/education/apiErrors.test.js
//
// Распознавание ошибок Anthropic API.
//
// describeApiError — общий классификатор для ВСЕХ обращений к модели:
// диагностика, радиология, обучение. От него зависят две вещи: что увидит
// врач и можно ли повторить запрос.
//
// ГЛАВНОЕ, ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ — ошибка, пришедшая ПОСРЕДИ потока.
// Все обращения к модели идут через messages.stream(). Когда ответ уже
// начался, HTTP-статус отдан (200) и изменить его нельзя, поэтому сбой
// приходит SSE-событием, а SDK бросает APIError со status === undefined и
// без подкласса (core/streaming.js). Классификатор, смотрящий только на
// статус и instanceof, такую ошибку не узнаёт: врач получал сырой JSON, а
// пометка «повтор невозможен» запрещала попробовать снова — при том, что
// перегрузка проходит сама за минуту.

import { describe, it, expect } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { APIError } from "@anthropic-ai/sdk/error.js";
import {
  describeApiError,
  isTransientApiError,
  withApiRetry,
} from "../../modules/education/education-ingest/extractors/claude.extractor.js";

/**
 * Ошибка ровно в том виде, в каком её строит SDK для SSE-события error:
 * статус не передаётся вовсе, тип живёт только в теле.
 */
function streamError(type, message = "Error") {
  const body = {
    type: "error",
    error: { details: null, type, message },
    request_id: "req_011CdjGbGp3MgHjdbvaMZLYD",
  };
  return new APIError(undefined, body, undefined, new Headers(), type);
}

describe("describeApiError: ошибка посреди потока", () => {
  it("перегрузка API распознаётся и разрешает повтор", () => {
    const res = describeApiError(streamError("overloaded_error", "Overloaded"));

    expect(res.retryable).toBe(true);
    expect(res.message).toMatch(/перегружен/i);
    // Сырой JSON врачу не показываем ни при каких условиях.
    expect(res.message).not.toMatch(/[{}]|request_id/);
  });

  it("превышение лимита распознаётся без HTTP-статуса", () => {
    const res = describeApiError(streamError("rate_limit_error"));

    expect(res.retryable).toBe(true);
    expect(res.message).toMatch(/лимит/i);
  });

  it("внутренняя ошибка API распознаётся без HTTP-статуса", () => {
    const res = describeApiError(streamError("api_error"));

    expect(res.retryable).toBe(true);
    expect(res.message).toMatch(/недоступен/i);
  });

  it("отклонённый ключ остаётся неповторяемым", () => {
    const res = describeApiError(streamError("authentication_error"));

    expect(res.retryable).toBe(false);
    expect(res.message).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("слишком большой запрос остаётся неповторяемым", () => {
    const res = describeApiError(streamError("request_too_large"));

    expect(res.retryable).toBe(false);
    expect(res.message).toMatch(/слишком большой/i);
  });
});

describe("describeApiError: ошибка до начала потока", () => {
  // Обычный путь — ответ не начался, статус на месте. Проверяем, что
  // разбор тела его не сломал.
  it("401 по статусу", () => {
    const res = describeApiError({ status: 401 });
    expect(res.retryable).toBe(false);
    expect(res.message).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("429 по статусу", () => {
    const res = describeApiError({ status: 429 });
    expect(res.retryable).toBe(true);
  });

  it("529 по статусу — перегрузка, а не общий сбой", () => {
    const res = describeApiError({ status: 529 });
    expect(res.retryable).toBe(true);
    expect(res.message).toMatch(/перегружен/i);
  });

  it("500 по статусу", () => {
    const res = describeApiError({ status: 500 });
    expect(res.retryable).toBe(true);
    expect(res.message).toMatch(/недоступен/i);
  });

  it("обрыв связи распознаётся по классу SDK", () => {
    const res = describeApiError(new Anthropic.APIConnectionError({ message: "fail" }));
    expect(res.retryable).toBe(true);
    expect(res.message).toMatch(/связаться/i);
  });

  it("неизвестная ошибка остаётся неповторяемой", () => {
    const res = describeApiError(new Error("что-то своё"));
    expect(res.retryable).toBe(false);
    expect(res.message).toMatch(/что-то своё/);
  });
});

describe("автоматический повтор при временном сбое", () => {
  // Пауза сжата до 1 мс: проверяется решение повторить, а не длительность.
  const fast = { retries: 2, baseDelayMs: 1 };

  it("перегрузка посреди потока считается временной", () => {
    expect(isTransientApiError(streamError("overloaded_error"))).toBe(true);
  });

  it("превышенный лимит НЕ считается временным — повтор его усугубит", () => {
    expect(isTransientApiError(streamError("rate_limit_error"))).toBe(false);
    expect(isTransientApiError({ status: 429 })).toBe(false);
  });

  it("отклонённый ключ не повторяется", () => {
    expect(isTransientApiError({ status: 401 })).toBe(false);
  });

  it("повторяет перегрузку и возвращает результат следующей попытки", async () => {
    let calls = 0;
    const result = await withApiRetry(async () => {
      calls += 1;
      if (calls === 1) throw streamError("overloaded_error", "Overloaded");
      return "разбор готов";
    }, fast);

    expect(result).toBe("разбор готов");
    expect(calls).toBe(2);
  });

  it("сдаётся после исчерпания попыток и отдаёт исходную ошибку", async () => {
    let calls = 0;
    await expect(
      withApiRetry(async () => {
        calls += 1;
        throw streamError("overloaded_error", "Overloaded");
      }, fast),
    ).rejects.toThrow(/Overloaded|overloaded/);

    // Первая попытка плюс два повтора.
    expect(calls).toBe(3);
  });

  it("ошибку ключа не повторяет вовсе", async () => {
    let calls = 0;
    await expect(
      withApiRetry(async () => {
        calls += 1;
        throw streamError("authentication_error");
      }, fast),
    ).rejects.toBeTruthy();

    expect(calls).toBe(1);
  });

  it("успешный вызов не трогает", async () => {
    let calls = 0;
    const result = await withApiRetry(async () => {
      calls += 1;
      return "ок";
    }, fast);

    expect(result).toBe("ок");
    expect(calls).toBe(1);
  });
});
