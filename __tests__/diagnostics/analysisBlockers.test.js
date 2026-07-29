// __tests__/diagnostics/analysisBlockers.test.js
//
// Гейты запуска разбора.
//
// Главный здесь — файл, из которого не извлёкся текст. Реальный случай: врач
// приложил КТ околоносовых пазух, текст из снимка не извлёкся, разбор всё
// равно запустился и пришёл про внутричерепное образование — потому что
// разобрался текст, лежавший в деле с прошлого раза. Файл прошёл проверку как
// «материал», хотя в разборе не участвовал ни одним символом.
//
// Это худший вид ошибки в таком продукте: не отказ, который видно, а
// уверенный ответ не на тот вопрос.

import { describe, it, expect } from "vitest";
import { collectAnalysisBlockers } from "../../modules/diagnostics/core/services/analysis.service.js";

// Дело, где все прочие гейты уже пройдены: обезличено, согласие есть, открыто.
const ready = {
  deidentified: true,
  aiConsent: { confirmed: true },
  status: "draft",
  clinicalContext: "текст, оставшийся в деле с прошлого раза",
};

describe("файл, из которого не извлёкся текст", () => {
  it("не даёт запустить разбор, когда ни из одного файла текст не извлёкся", () => {
    const blockers = collectAnalysisBlockers(ready, [
      { kind: "image", text: "", structured: null },
    ]);
    expect(blockers.join(" ")).toMatch(/не извлёкся текст/i);
  });

  it("предупреждает, если текст не извлёкся только из части файлов", () => {
    const blockers = collectAnalysisBlockers(ready, [
      { kind: "report", text: "Заключение: без патологии." },
      { kind: "image", text: "", structured: null },
    ]);
    expect(blockers.join(" ")).toMatch(/в разбор они не войдут/i);
  });

  it("структурированную панель показателей считает полноценным материалом", () => {
    // У панели нет text, но она разбирается labsAnalyzer'ом — это материал.
    const blockers = collectAnalysisBlockers(ready, [
      { kind: "labs", text: "", structured: { items: [{ key: "hb", value: "90" }] } },
    ]);
    expect(blockers.join(" ")).not.toMatch(/не извлёкся текст/i);
  });

  it("читаемый документ по-прежнему пропускает разбор", () => {
    const blockers = collectAnalysisBlockers(ready, [
      { kind: "report", text: "КТ околоносовых пазух: пристеночный отёк слизистой." },
    ]);
    expect(blockers).toEqual([]);
  });

  it("пустое дело без файлов ловится прежней проверкой, а не новой", () => {
    const blockers = collectAnalysisBlockers(
      { ...ready, clinicalContext: "" },
      [],
    );
    expect(blockers.join(" ")).toMatch(/добавьте материалы/i);
    expect(blockers.join(" ")).not.toMatch(/не извлёкся текст/i);
  });
});

describe("прежние гейты не сломаны", () => {
  it("требует обезличивания и согласия", () => {
    const blockers = collectAnalysisBlockers(
      { deidentified: false, aiConsent: {}, status: "draft", clinicalContext: "есть" },
      [],
    );
    expect(blockers.join(" ")).toMatch(/обезличен/i);
    expect(blockers.join(" ")).toMatch(/согласие/i);
  });

  it("не даёт разбирать закрытое дело", () => {
    const blockers = collectAnalysisBlockers(
      { ...ready, status: "closed" },
      [{ kind: "report", text: "текст" }],
    );
    expect(blockers.join(" ")).toMatch(/закрыт/i);
  });
});
