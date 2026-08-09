// __tests__/radiology/caseAutoFix.test.js
//
// ТРЕТИЙ ПРОХОД: цикл «правка → перепроверка» (ai/autoFix.js) и запись его
// результата в кейс (applyLabAiRevision).
//
// Модель здесь не вызывается: revise и verify — подставные функции по
// сценарию. Проверяется именно то, за что цикл отвечает сам, — когда он
// останавливается и какую версию отдаёт. Ошибка в этих правилах стоит либо
// денег (лишние круги Opus), либо качества (отдали худшую версию).
//
// Отдельно — сопоставление ключей показателей при сохранении правок. Модель
// возвращает панель БЕЗ ключей, а на ключ завязаны эталон, варианты и разборы
// уже сданных попыток: перепутать их значит получить кейс, который выглядит
// целым, но оценивает неверно.

import { describe, it, expect, beforeEach } from "vitest";
import { runAutoFix, runTargetedFix } from "../../modules/radiology/ai/autoFix.js";
import { applyLabAiRevision } from "../../modules/radiology/labs-station/lab.service.js";
import LabCase from "../../modules/radiology/labs-station/models/labCase.model.js";

// ─── Помощники: рецензия с заданным числом замечаний ──────────────────
const issue = (n) => ({
  target: `Показатель ${n}`,
  severity: "warning",
  issue: `Замечание ${n}`,
  suggestion: "",
});
const review = (count) => ({
  verdict: count ? "issues" : "clean",
  issues: Array.from({ length: count }, (_, i) => issue(i + 1)),
  errorCount: 0,
  summary: "",
  usage: { inputTokens: 10, outputTokens: 5 },
});

/** Рецензент, выдающий заранее заданную последовательность чисел замечаний. */
function verifierOf(counts) {
  let call = 0;
  const fn = async () => {
    const n = counts[Math.min(call, counts.length - 1)];
    call += 1;
    return review(n);
  };
  fn.calls = () => call;
  return fn;
}

/** Редактор, помечающий черновик номером круга — чтобы видеть, что вернулось. */
function reviserOf() {
  let call = 0;
  const fn = async (draft) => {
    call += 1;
    return {
      draft: { ...draft, round: call },
      changes: [{ target: "Ферритин", change: `правка круга ${call}`, why: "по замечанию" }],
      disputed: [],
      usage: { inputTokens: 20, outputTokens: 10 },
    };
  };
  fn.calls = () => call;
  return fn;
}

const BASE_DRAFT = { title: "Кейс", panel: [{ name: "Гемоглобин" }], round: 0 };

describe("цикл правка → перепроверка", () => {
  it("останавливается, как только рецензия стала чистой", async () => {
    const verify = verifierOf([2, 0]);
    const revise = reviserOf();

    const out = await runAutoFix({ draft: BASE_DRAFT, revise, verify });

    expect(out.converged).toBe(true);
    expect(out.stoppedBy).toBe("clean");
    expect(out.rounds).toHaveLength(1);
    expect(out.draft.round).toBe(1);
    // Лишнего круга нет: правка вызвана один раз.
    expect(revise.calls()).toBe(1);
  });

  it("не тратит вызов на рецензию, если она уже посчитана", async () => {
    const verify = verifierOf([0]);
    const revise = reviserOf();

    const out = await runAutoFix({
      draft: BASE_DRAFT,
      review: review(0),
      revise,
      verify,
    });

    expect(out.converged).toBe(true);
    expect(verify.calls()).toBe(0);
    expect(revise.calls()).toBe(0);
  });

  it("считает рецензию сам, если её не передали", async () => {
    const verify = verifierOf([0]);
    const out = await runAutoFix({ draft: BASE_DRAFT, revise: reviserOf(), verify });
    expect(verify.calls()).toBe(1);
    expect(out.converged).toBe(true);
  });

  it("упирается в потолок кругов и честно об этом говорит", async () => {
    // Замечания убывают, но до нуля не доходят: 3 → 2 → 1.
    const verify = verifierOf([3, 2, 1]);
    const revise = reviserOf();

    const out = await runAutoFix({ draft: BASE_DRAFT, revise, verify, maxRounds: 2 });

    expect(out.converged).toBe(false);
    expect(out.stoppedBy).toBe("max_rounds");
    expect(out.rounds).toHaveLength(2);
    expect(out.review.issues).toHaveLength(1);
  });

  it("бросает круги, когда правка перестала убирать замечания", async () => {
    // 2 → 2: редактор и рецензент разошлись во мнениях, дальше топтание.
    const verify = verifierOf([2, 2]);
    const revise = reviserOf();

    const out = await runAutoFix({ draft: BASE_DRAFT, revise, verify, maxRounds: 5 });

    expect(out.stoppedBy).toBe("no_progress");
    expect(revise.calls()).toBe(1);
    // Версия не улучшилась — отдаём ту, что была на входе, а не «свежую».
    expect(out.draft.round).toBe(0);
  });

  it("возвращает лучший из виденных вариантов, а не последний", async () => {
    // 3 → 1 (лучше) → 2 (хуже): отдать надо версию первого круга.
    const verify = verifierOf([3, 1, 2]);
    const revise = reviserOf();

    const out = await runAutoFix({ draft: BASE_DRAFT, revise, verify, maxRounds: 5 });

    expect(out.draft.round).toBe(1);
    expect(out.review.issues).toHaveLength(1);
    expect(out.stoppedBy).toBe("no_progress");
  });

  it("копит правки от исходного черновика до лучшей версии", async () => {
    const out = await runAutoFix({
      draft: BASE_DRAFT,
      revise: reviserOf(),
      verify: verifierOf([3, 2, 0]),
      maxRounds: 3,
    });

    expect(out.converged).toBe(true);
    // Две правки за два круга: автор смотрит дифф целиком, а не последний шаг.
    expect(out.changes).toHaveLength(2);
    expect(out.changes[0].change).toContain("круга 1");
    expect(out.changes[1].change).toContain("круга 2");
  });

  it("суммирует токены всех вызовов — цикл платный, и это должно быть видно", async () => {
    const out = await runAutoFix({
      draft: BASE_DRAFT,
      revise: reviserOf(),
      verify: verifierOf([2, 0]),
    });
    // Рецензия (10/5) + правка (20/10) + перепроверка (10/5).
    expect(out.usage.inputTokens).toBe(40);
    expect(out.usage.outputTokens).toBe(20);
  });

  it("сбой на первом круге пробрасывается: отдавать нечего", async () => {
    const failing = async () => {
      throw new Error("модель недоступна");
    };
    await expect(
      runAutoFix({ draft: BASE_DRAFT, revise: failing, verify: verifierOf([2]) }),
    ).rejects.toThrow(/модель недоступна/);
  });

  it("сбой на следующем круге не отменяет уже сделанного", async () => {
    let call = 0;
    const revise = async (draft) => {
      call += 1;
      if (call > 1) throw new Error("модель недоступна");
      return { draft: { ...draft, round: 1 }, changes: [], disputed: [], usage: {} };
    };

    const out = await runAutoFix({
      draft: BASE_DRAFT,
      revise,
      verify: verifierOf([3, 1, 1]),
      maxRounds: 3,
    });

    expect(out.stoppedBy).toBe("error");
    expect(out.draft.round).toBe(1);
    expect(out.review.issues).toHaveLength(1);
  });
});

describe("точечная правка одного замечания", () => {
  it("принимает результат, даже если рецензент нашёл остальные замечания", async () => {
    // Автор просит исправить ОДНО замечание из четырёх. Рецензент честно
    // возвращает три оставшихся — по правилу «лучшая версия» это выглядело бы
    // ухудшением (1 → 3), и полный цикл откатил бы правку. Здесь результат
    // принимается: что править, решил человек.
    const out = await runTargetedFix({
      draft: BASE_DRAFT,
      issues: [issue(1)],
      revise: reviserOf(),
      verify: verifierOf([3]),
    });

    expect(out.draft.round).toBe(1);
    expect(out.stoppedBy).toBe("targeted");
    expect(out.converged).toBe(false);
    expect(out.review.issues).toHaveLength(3);
    expect(out.changes).toHaveLength(1);
  });

  it("делает ровно один круг — большего у него не просили", async () => {
    const revise = reviserOf();
    const verify = verifierOf([2, 1, 0]);

    await runTargetedFix({ draft: BASE_DRAFT, issues: [issue(1)], revise, verify });

    expect(revise.calls()).toBe(1);
    // Одна перепроверка: сохранённая рецензия должна относиться к новой
    // версии кейса, но доводить его до чистой здесь не просили.
    expect(verify.calls()).toBe(1);
  });

  it("сошлось с первого раза — отмечает это как converged", async () => {
    const out = await runTargetedFix({
      draft: BASE_DRAFT,
      issues: [issue(1)],
      revise: reviserOf(),
      verify: verifierOf([0]),
    });
    expect(out.converged).toBe(true);
    expect(out.review.issues).toHaveLength(0);
  });
});

// ─── Запись правок в кейс ─────────────────────────────────────────────

async function makeCase(extra = {}) {
  return LabCase.create({
    title: "Железодефицитная анемия",
    clinicalContext: "Женщина 32 лет",
    panel: [
      { key: "hgb", name: "Гемоглобин", value: "88", unit: "г/л", refRange: "120–150" },
      { key: "ferritin", name: "Ферритин", value: "40", unit: "мкг/л", refRange: "15–150" },
    ],
    significantAbnormal: ["hgb"],
    impression: { correctText: "ЖДА", diagnosisKeys: ["железодефицитная анемия"] },
    source: { kind: "ai_generated" },
    status: "draft",
    ...extra,
  });
}

// Черновик от редактора: панель БЕЗ ключей, значения исправлены.
const REVISED = {
  title: "Железодефицитная анемия",
  clinicalContext: "Женщина 32 лет, жалобы на слабость",
  panel: [
    { name: "Гемоглобин", value: "88", unit: "г/л", refRange: "120–150", significant: true },
    { name: "Ферритин", value: "4", unit: "мкг/л", refRange: "15–150", significant: true },
  ],
  impression: { correctText: "ЖДА, исправлено", diagnosisKeys: ["жда"], diagnosisSynonyms: [] },
};

describe("запись машинных правок в кейс", () => {
  let doc;
  beforeEach(async () => {
    doc = await makeCase();
  });

  it("сохраняет ключи показателей по совпадению названий", async () => {
    const { case: saved } = await applyLabAiRevision(doc._id, REVISED);

    expect(saved.panel.map((p) => p.key)).toEqual(["hgb", "ferritin"]);
    // Значение исправлено, ключ прежний — эталон и разборы не разъехались.
    expect(saved.panel[1].value).toBe("4");
  });

  it("пересобирает эталон из флагов significant", async () => {
    const { case: saved } = await applyLabAiRevision(doc._id, REVISED);
    expect(saved.significantAbnormal.sort()).toEqual(["ferritin", "hgb"]);
  });

  it("новому показателю даёт новый ключ, не задевая существующие", async () => {
    const withNewRow = {
      ...REVISED,
      panel: [
        ...REVISED.panel,
        { name: "Трансферрин", value: "3,8", unit: "г/л", refRange: "2,0–3,6", significant: true },
      ],
    };
    const { case: saved } = await applyLabAiRevision(doc._id, withNewRow);

    expect(saved.panel).toHaveLength(3);
    const keys = saved.panel.map((p) => p.key);
    expect(keys.slice(0, 2)).toEqual(["hgb", "ferritin"]);
    expect(new Set(keys).size).toBe(3);
  });

  it("пишет след правки: что менялось и чем цикл закончился", async () => {
    await applyLabAiRevision(doc._id, REVISED, {
      rounds: 2,
      stoppedBy: "clean",
      converged: true,
      changes: [{ target: "Ферритин", change: "40 → 4", why: "не согласуется с диагнозом" }],
      disputed: [{ issue: "АД странное", why: "для тиреотоксикоза типично" }],
      model: "claude-opus-5",
    });

    const fresh = await LabCase.findById(doc._id).lean();
    expect(fresh.aiRevision.rounds).toBe(2);
    expect(fresh.aiRevision.converged).toBe(true);
    expect(fresh.aiRevision.changes[0].change).toBe("40 → 4");
    expect(fresh.aiRevision.disputed).toHaveLength(1);
    expect(fresh.aiRevision.revisedAt).toBeTruthy();
  });

  it("числовые варианты чистит от исчезнувших показателей и сообщает об этом", async () => {
    const withVariants = await makeCase({
      variants: [
        {
          label: "Вариант A",
          panel: [
            { key: "hgb", value: "94" },
            { key: "gone", value: "1" },
          ],
          significantAbnormal: ["hgb", "gone"],
        },
        // Вариант целиком про исчезнувший показатель — удаляется: половина
        // варианта это не «частично годно», а чужой эталон.
        { label: "Вариант B", panel: [{ key: "gone", value: "2" }], significantAbnormal: ["gone"] },
      ],
    });

    const res = await applyLabAiRevision(withVariants._id, REVISED);

    expect(res.variantsStale).toBe(true);
    expect(res.case.variants).toHaveLength(1);
    expect(res.case.variants[0].panel.map((p) => p.key)).toEqual(["hgb"]);
    expect(res.case.variants[0].significantAbnormal).toEqual(["hgb"]);
  });

  it("опубликованный кейс машине править нельзя", async () => {
    const published = await makeCase({ status: "published", publishedAt: new Date() });
    await expect(applyLabAiRevision(published._id, REVISED)).rejects.toThrow(/снимите его с публикации/);
    // Данные остались нетронутыми.
    const fresh = await LabCase.findById(published._id).lean();
    expect(fresh.panel[1].value).toBe("40");
  });

  it("архивный кейс тоже не правится", async () => {
    const archived = await makeCase({ status: "archived" });
    await expect(applyLabAiRevision(archived._id, REVISED)).rejects.toThrow(/Архивный/);
  });

  it("обрезанную панель не принимает — это потеря данных, а не короткий кейс", async () => {
    await expect(
      applyLabAiRevision(doc._id, { ...REVISED, panel: [REVISED.panel[0]] }),
    ).rejects.toThrow(/меньше двух показателей/);
    const fresh = await LabCase.findById(doc._id).lean();
    expect(fresh.panel).toHaveLength(2);
  });
});
