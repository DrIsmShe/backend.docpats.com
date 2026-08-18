// __tests__/diagnostics/fallbacksRetry.test.js
//
// «Модель не принимает fallbacks» — распознавание ошибки, из-за которой
// на проде НЕ РАБОТАЛ НИ ОДИН вызов модели.
//
// ANTHROPIC_FALLBACKS включён по умолчанию, а claude-sonnet-5 параметр
// не принимает и отвечает 400 на каждый запрос. Падали разом: AI-разбор
// диагностики, расшифровка анализов, опрос перед приёмом и запись
// приёма — всё, что ходит через общий движок.
//
// Проверять по списку поддерживающих моделей нельзя: список меняется на
// стороне API, и наш перечень устареет молча. Поэтому распознаём саму
// ошибку — и вот это распознавание обязано быть точным.

import { describe, it, expect } from "vitest";
import { isUnsupportedFallbacks } from "../../modules/diagnostics/ai/runner.js";

describe("распознавание отказа от fallbacks", () => {
  it("узнаёт настоящую ошибку API", () => {
    const err = {
      status: 400,
      error: {
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "'claude-sonnet-5' does not support the `fallbacks` parameter.",
        },
      },
    };
    expect(isUnsupportedFallbacks(err)).toBe(true);
  });

  it("НЕ путает с ошибкой схемы", () => {
    // Широкая проверка проглотила бы настоящие ошибки запроса, и мы
    // повторяли бы заведомо неверный вызов дважды, платя за оба.
    const err = {
      status: 400,
      error: {
        error: {
          type: "invalid_request_error",
          message: "output_config.format.schema: unexpected key `maxItems`",
        },
      },
    };
    expect(isUnsupportedFallbacks(err)).toBe(false);
  });

  it("не срабатывает на других статусах", () => {
    // 429 и 529 — перегрузка, у неё своё лечение (повтор с паузой).
    const err = {
      status: 429,
      error: { error: { message: "fallbacks overloaded" } },
    };
    expect(isUnsupportedFallbacks(err)).toBe(false);
  });

  it("не падает на пустой ошибке", () => {
    expect(isUnsupportedFallbacks({})).toBe(false);
    expect(isUnsupportedFallbacks(null)).toBe(false);
  });
});
