// __tests__/dictation/codeSuggest.test.js
//
// Подсказка кодов МКБ к надиктованному диагнозу.
//
// Главное, что здесь защищается: подсказка НЕ превращается в автоматическую
// простановку. Код уходит в статистику и в счета, поэтому система предлагает,
// а выбирает врач. Тесты проверяют, что предложенное лежит отдельно от
// назначенного и не подменяет его.

import { describe, it, expect, beforeEach } from "vitest";

import MedicalCode, {
  CODE_SYSTEMS,
  normalizeCode,
  buildSearchText,
} from "../../modules/medicalCodes/models/medicalCode.model.js";
import { resetSearchStrategy } from "../../modules/medicalCodes/services/codeSearch.service.js";
import { enrichDraftWithCodes } from "../../modules/dictation/services/codeSuggest.service.js";
import { sanitizeDraft } from "../../modules/dictation/dictation.service.js";

async function seed() {
  const rows = [
    { code: "J35.01", en: "Chronic tonsillitis", ru: "Хронический тонзиллит" },
    { code: "J03.90", en: "Acute tonsillitis, unspecified", ru: "Острый тонзиллит неуточнённый" },
    { code: "E11.9", en: "Type 2 diabetes mellitus", ru: "Сахарный диабет 2 типа" },
  ];

  await MedicalCode.insertMany(
    rows.map(({ code, en, ru }) => {
      const doc = {
        system: CODE_SYSTEMS.ICD10CM,
        code,
        codeNormalized: normalizeCode(code),
        titles: { en, ru, az: "", tr: "", ar: "" },
        parentCode: code.split(".")[0],
        isBillable: true,
      };
      return { ...doc, searchText: buildSearchText(doc) };
    }),
  );
}

describe("подсказка кодов к надиктовке", () => {
  beforeEach(async () => {
    resetSearchStrategy();
    await seed();
  });

  it("подставляет официальное название к коду, названному врачом", async () => {
    const draft = await enrichDraftWithCodes(
      { mainDiagnosisText: "хронический тонзиллит", mainDiagnosisCode: "J35.01" },
      "ru",
    );

    expect(draft.mainDiagnosisCodeTitle).toBe("Хронический тонзиллит");
    // Кандидатов рядом с уже названным кодом не показываем — врач начал бы
    // выбирать заново то, что уже сказал.
    expect(draft.codeSuggestions).toBeUndefined();
  });

  it("название берётся из справочника, а не из речи врача", async () => {
    const draft = await enrichDraftWithCodes(
      {
        mainDiagnosisText: "тонзиллит хронический, обострение",
        mainDiagnosisCode: "J35.01",
      },
      "ru",
    );

    expect(draft.mainDiagnosisCodeTitle).toBe("Хронический тонзиллит");
    expect(draft.mainDiagnosisCodeTitle).not.toContain("обострение");
  });

  it("код принимается в любом написании", async () => {
    const draft = await enrichDraftWithCodes(
      { mainDiagnosisCode: "j3501" },
      "ru",
    );
    expect(draft.mainDiagnosisCodeTitle).toBe("Хронический тонзиллит");
  });

  it("помечает код, которого нет в справочнике", async () => {
    // Так выглядит опечатка распознавания: «Джей 35 ноль один» → "J35.0X".
    const draft = await enrichDraftWithCodes(
      { mainDiagnosisText: "тонзиллит", mainDiagnosisCode: "J99.99" },
      "ru",
    );

    expect(draft.mainDiagnosisCodeUnknown).toBe(true);
    expect(draft.mainDiagnosisCodeTitle).toBeUndefined();
    // Раз код не опознан — предлагаем кандидатов по тексту.
    expect(draft.codeSuggestions?.length).toBeGreaterThan(0);
  });

  it("предлагает кандидатов по русскому тексту, когда код не назван", async () => {
    const draft = await enrichDraftWithCodes(
      { mainDiagnosisText: "тонзиллит", mainDiagnosisCode: null },
      "ru",
    );

    const codes = draft.codeSuggestions.map((s) => s.code);
    expect(codes).toContain("J35.01");
    expect(codes).toContain("J03.90");
    // Ничего не проставлено: выбор за врачом.
    expect(draft.mainDiagnosisCode).toBeNull();
  });

  it("находит код по английскому термину, когда перевода ещё нет", async () => {
    // Справочник переводится постепенно; поиск только по языку врача нашёл бы
    // лишь переведённую часть. Поэтому модель отдаёт английский термин.
    await MedicalCode.updateOne(
      { code: "E11.9" },
      { $set: { "titles.ru": "", searchText: "E11.9 E119 Type 2 diabetes mellitus" } },
    );

    const draft = await enrichDraftWithCodes(
      {
        mainDiagnosisText: "сахарный диабет второго типа",
        mainDiagnosisTermEn: "type 2 diabetes mellitus",
        mainDiagnosisCode: null,
      },
      "ru",
    );

    expect(draft.codeSuggestions.map((s) => s.code)).toContain("E11.9");
  });

  it("не падает, когда диагноз не назван", async () => {
    const draft = await enrichDraftWithCodes(
      { complaints: "боль в горле", mainDiagnosisText: null, mainDiagnosisCode: null },
      "ru",
    );

    expect(draft.codeSuggestions).toBeUndefined();
    expect(draft.complaints).toBe("боль в горле");
  });

  it("не ломает надиктовку, если справочник пуст", async () => {
    await MedicalCode.deleteMany({});

    const draft = await enrichDraftWithCodes(
      { mainDiagnosisText: "тонзиллит", mainDiagnosisCode: "J35.01" },
      "ru",
    );

    // Черновик вернулся целым — надиктовка ценна и без кода.
    expect(draft.mainDiagnosisText).toBe("тонзиллит");
    expect(draft.mainDiagnosisCodeTitle).toBeUndefined();
  });
});

describe("служебные поля черновика", () => {
  it("не принимаются от клиента", () => {
    // Иначе через правку черновика можно было бы подставить к коду
    // произвольное «официальное» название.
    const fromClient = sanitizeDraft({
      mainDiagnosisText: "тонзиллит",
      mainDiagnosisCodeTitle: "ЧТО УГОДНО",
      codeSuggestions: [{ code: "X00", title: "подделка" }],
    });

    expect(fromClient.mainDiagnosisText).toBe("тонзиллит");
    expect(fromClient.mainDiagnosisCodeTitle).toBeUndefined();
    expect(fromClient.codeSuggestions).toBeUndefined();
  });

  it("сохраняются, когда их кладёт сама система", () => {
    const internal = sanitizeDraft(
      {
        mainDiagnosisText: "тонзиллит",
        mainDiagnosisCodeTitle: "Хронический тонзиллит",
        codeSuggestions: [
          { code: "J35.01", title: "Хронический тонзиллит", titleEn: "Chronic tonsillitis" },
        ],
      },
      { keepDerived: true },
    );

    expect(internal.mainDiagnosisCodeTitle).toBe("Хронический тонзиллит");
    expect(internal.codeSuggestions).toHaveLength(1);
  });

  it("служебный английский термин в черновик не сохраняется", () => {
    // Он нужен только для запроса в справочник; врачу не показывается.
    const saved = sanitizeDraft(
      { mainDiagnosisText: "тонзиллит", mainDiagnosisTermEn: "chronic tonsillitis" },
      { keepDerived: true },
    );

    expect(saved.mainDiagnosisTermEn).toBeUndefined();
  });

  it("ограничивает число подсказок", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      code: `A0${i}`,
      title: `Диагноз ${i}`,
    }));

    const saved = sanitizeDraft({ codeSuggestions: many }, { keepDerived: true });
    expect(saved.codeSuggestions).toHaveLength(5);
  });
});
