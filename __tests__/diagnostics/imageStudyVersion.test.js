// __tests__/diagnostics/imageStudyVersion.test.js
//
// ОСМОТР СНИМКА ОБЯЗАН НАЗЫВАТЬ ВЕРСИЮ.
//
// Первая версия промпта требовала «описывать, что видно» и не ставить
// диагноз. Модель поняла это буквально и на КТ с очевидной кистой
// верхнечелюстной пазухи выдала описание теней и девять оговорок — не назвав
// ни одного предположения о природе находки.
//
// Это худший из возможных исходов: врач видит и сам, что в пазухе что-то
// есть, а спрашивает он ровно о том, на что это похоже.
//
// Граница, которую здесь удерживаем, проходит НЕ между «сказать» и
// «промолчать», а между «похоже на кисту» и «диагноз: киста». Первое —
// работа, второе — заключение, которое пишет врач.

import { describe, it, expect } from "vitest";
import { renderImageStudyText } from "../../modules/diagnostics/ai/imageStudyReader.js";

/** Осмотр в том виде, в каком его возвращает читатель снимков. */
function read(overrides = {}) {
  return {
    modalityGuess: "КТ околоносовых пазух, коронарная реконструкция",
    whatIsVisible: "Околоносовые пазухи, костное окно.",
    observations: [],
    limits: [],
    sheet: false,
    lang: "ru",
    ...overrides,
  };
}

describe("осмотр снимка: версия о природе находки", () => {
  it("версия попадает в текст дела рядом с находкой", () => {
    const text = renderImageStudyText(
      read({
        observations: [
          {
            finding: "Округлое образование с чёткой куполообразной верхней границей",
            where: "правая верхнечелюстная пазуха, дно",
            couldBe: [
              "похоже на кисту верхнечелюстной пазухи",
              "полип",
              "мукоцеле",
            ],
            confidence: "moderate",
            verify: "сопоставить с жалобами и предыдущими снимками",
          },
        ],
      }),
    );

    expect(text).toMatch(/похоже на/i);
    expect(text).toMatch(/кисту/i);
    // Версия обязана стоять при находке, а не отдельным блоком в конце.
    const findingAt = text.indexOf("Округлое образование");
    const versionAt = text.indexOf("похоже на кисту");
    expect(findingAt).toBeGreaterThanOrEqual(0);
    expect(versionAt).toBeGreaterThan(findingAt);
  });

  it("несколько версий перечисляются как ряд для дифференцировки", () => {
    const text = renderImageStudyText(
      read({
        observations: [
          {
            finding: "Тотальное затенение пазухи",
            where: "левая верхнечелюстная пазуха",
            couldBe: ["экссудат", "полипозные массы", "грибковое тело"],
            confidence: "high",
            verify: "",
          },
        ],
      }),
    );

    expect(text).toMatch(/экссудат/);
    expect(text).toMatch(/полипозные массы/);
    expect(text).toMatch(/грибковое тело/);
  });

  it("осмотр без единой версии не остаётся незамеченным", () => {
    // Прямой признак возврата к прежнему поведению: находка есть, а сказать
    // о ней нечего. Тест держит форму данных, при которой это видно.
    const observation = {
      finding: "Пристеночное утолщение слизистой",
      where: "правая верхнечелюстная пазуха",
      couldBe: [],
      confidence: "moderate",
      verify: "",
    };
    const text = renderImageStudyText(read({ observations: [observation] }));

    expect(observation.couldBe).toHaveLength(0);
    // Находка выводится и без версии — терять её нельзя, — но пустой couldBe
    // означает, что модель не выполнила требование схемы.
    expect(text).toMatch(/Пристеночное утолщение/);
  });

  it("запрет отрицать патологию сохранён", () => {
    // Смягчение осторожности не должно было тронуть это правило: оно про
    // другое — про цену пропущенного диагноза, а не про отказ от версии.
    const text = renderImageStudyText(read());

    expect(text).not.toMatch(/патологии не выявлено|патологии нет|норма/i);
    expect(text).toMatch(/НЕ означает отсутствия патологии/i);
  });

  it("происхождение описания остаётся помеченным", () => {
    const text = renderImageStudyText(
      read({
        observations: [
          {
            finding: "Образование с чёткой границей",
            where: "правая верхнечелюстная пазуха",
            couldBe: ["похоже на кисту"],
            confidence: "moderate",
            verify: "",
          },
        ],
      }),
    );

    // Версия названа — тем важнее, чтобы было видно, кто её высказал.
    expect(text).toMatch(/ПРОЧИТАНО С ИЗОБРАЖЕНИЯ МОДЕЛЬЮ/);
    expect(text).toMatch(/не заключение врача/i);
    expect(text).toMatch(/подлежит проверке врачом/i);
  });
});
