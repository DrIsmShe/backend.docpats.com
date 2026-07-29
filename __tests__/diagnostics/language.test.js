// __tests__/diagnostics/language.test.js
//
// Язык разбора.
//
// До этого модель писала по-русски всегда: правило стояло в промпте, а язык
// врача до сервера не доезжал вовсе. Интерфейс при этом переводился на пять
// языков, и врач на азербайджанском получал переведённые заголовки над
// русским текстом.
//
// Здесь проверяется цепочка целиком: язык доезжает до промпта, сохраняется в
// задании (разбор идёт в фоновом воркере, где запроса уже нет), и подписи,
// которые сервер вклеивает в текст дела, тоже переводятся.
//
// Качество медицинской терминологии на az/tr/ar эти тесты НЕ проверяют — это
// работа для врача-носителя, и её никакой assert не заменит.

import { describe, it, expect } from "vitest";
import {
  normalizeLang,
  languageRule,
  imageText,
  SUPPORTED_LANGS,
} from "../../modules/diagnostics/ai/language.js";
import { systemFor } from "../../modules/diagnostics/ai/analyzers.js";
import { renderImageStudyText } from "../../modules/diagnostics/ai/imageStudyReader.js";

describe("приведение языка", () => {
  it("понимает язык с регионом: i18next шлёт «az-AZ», а не «az»", () => {
    expect(normalizeLang("az-AZ")).toBe("az");
    expect(normalizeLang("en_US")).toBe("en");
    expect(normalizeLang("TR")).toBe("tr");
  });

  it("неизвестный язык — русский, а не падение разбора", () => {
    // Разбор клинического материала не должен ломаться из-за того, что
    // клиент прислал «de» или мусор.
    expect(normalizeLang("de")).toBe("ru");
    expect(normalizeLang("")).toBe("ru");
    expect(normalizeLang(null)).toBe("ru");
    expect(normalizeLang(undefined)).toBe("ru");
    expect(normalizeLang(42)).toBe("ru");
    expect(normalizeLang("../../etc/passwd")).toBe("ru");
  });
});

describe("правило языка в промпте", () => {
  it("для каждого поддерживаемого языка правило есть и оно своё", () => {
    const rules = SUPPORTED_LANGS.map((l) => languageRule(l));
    expect(rules.every(Boolean)).toBe(true);
    expect(new Set(rules).size).toBe(SUPPORTED_LANGS.length);
  });
});

describe("рамка разбора под язык врача", () => {
  it("подставляет язык и не оставляет заглушку в промпте", () => {
    for (const lang of SUPPORTED_LANGS) {
      const sys = systemFor(lang);
      // Незаменённая заглушка означала бы, что модель получила «6. __LANGUAGE_RULE__»
      // вместо требования к языку — и написала бы на чём угодно.
      expect(sys).not.toMatch(/__LANGUAGE_RULE__/);
      expect(sys).toContain(languageRule(lang));
    }
  });

  it("остальные правила одинаковы на всех языках", () => {
    // Инструкции остаются русскими намеренно: они выверены по формулировкам,
    // и пять независимых переводов разъезжались бы при каждой правке.
    // Проверяем самое дорогое из них — разделение findings и dataGaps.
    for (const lang of SUPPORTED_LANGS) {
      const sys = systemFor(lang);
      expect(sys).toContain("findings — только утверждения О ПАЦИЕНТЕ И МАТЕРИАЛЕ");
      expect(sys).toContain("Неполнота описания критической не бывает");
      expect(sys).toContain("ПЕРВЫМ в findings ставь ведущую версию");
    }
  });

  it("неизвестный язык не ломает рамку, а даёт русскую", () => {
    expect(systemFor("de")).toBe(systemFor("ru"));
  });
});

describe("подписи в тексте описания снимка", () => {
  const read = (lang, extra = {}) => ({
    modalityGuess: "chest x-ray",
    whatIsVisible: "frontal projection",
    observations: [],
    limits: [],
    sheet: false,
    lang,
    ...extra,
  });

  it("шапка и оговорка переводятся вместе с текстом", () => {
    // Эти строки сервер вклеивает в ТЕЛО материала дела и сохраняет в базу.
    // Словарям клиента их отдать нельзя — они уже часть сохранённого текста.
    const ru = renderImageStudyText(read("ru"));
    const en = renderImageStudyText(read("en"));
    const tr = renderImageStudyText(read("tr"));

    expect(ru).toContain("ПРОЧИТАНО С ИЗОБРАЖЕНИЯ МОДЕЛЬЮ");
    expect(en).toContain("READ FROM THE IMAGE BY A MODEL");
    expect(tr).toContain("GÖRÜNTÜDEN MODEL TARAFINDAN OKUNDU");
    // В английском варианте не должно остаться русских хвостов.
    expect(en).not.toMatch(/[А-Яа-я]/);
    expect(tr).not.toMatch(/[А-Яа-я]/);
  });

  it("на каждом языке сохраняется запрет отрицать патологию", () => {
    // Самое важное правило модуля. Если оно потеряется при переводе, врач
    // прочитает «изменений нет» как норму — и не назначит исследование.
    for (const lang of SUPPORTED_LANGS) {
      const text = renderImageStudyText(read(lang));
      const T = imageText(lang);
      expect(text).toContain(T.nothingOne);
      expect(text).toContain(T.notAbsence);
    }
  });

  it("оговорка про выборку срезов тоже переведена", () => {
    for (const lang of SUPPORTED_LANGS) {
      const text = renderImageStudyText(read(lang, { sheet: true }));
      expect(text).toContain(imageText(lang).footerSheet);
      expect(text).not.toContain(imageText(lang).footerOne);
    }
  });

  it("уверенность наблюдения подписана на языке врача", () => {
    const en = renderImageStudyText(
      read("en", {
        observations: [
          { finding: "opacity", where: "right lower zone", confidence: "moderate", verify: "CT" },
        ],
      }),
    );
    expect(en).toContain("probable");
    expect(en).not.toContain("предположительно");
  });

  it("дело без языка читается как русское, а не падает", () => {
    // Дела, разобранные до появления языка, лежат в базе без этого поля.
    const text = renderImageStudyText(read(undefined));
    expect(text).toContain("ПРОЧИТАНО С ИЗОБРАЖЕНИЯ МОДЕЛЬЮ");
  });
});
