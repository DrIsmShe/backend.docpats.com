// __tests__/medical-codes/interventionCodes.test.js
//
// Коды вмешательств (операций) и их место в записи об операции.
//
// Главное, что здесь проверяется: болезни и вмешательства живут в одной
// коллекции, но НЕ смешиваются в выдаче. Код "28.2" — это и рубрика МКБ-10, и
// тонзиллэктомия в номенклатуре процедур; подставить одно вместо другого
// означало бы записать в карту не ту операцию.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";

import MedicalCode, {
  CODE_SYSTEMS,
  INTERVENTION_SYSTEMS,
  normalizeCode,
  buildSearchText,
} from "../../modules/medicalCodes/models/medicalCode.model.js";
import {
  searchCodes,
  getCode,
  resetSearchStrategy,
} from "../../modules/medicalCodes/services/codeSearch.service.js";
import SurgicalCase from "../../modules/surgery/surgicalCase.model.js";

function makeDoc({ system, code, en, isBillable = true }) {
  const doc = {
    system,
    code,
    codeNormalized: normalizeCode(code),
    titles: { en, ru: "", az: "", tr: "", ar: "" },
    parentCode: code.split(".")[0],
    isBillable,
  };
  return { ...doc, searchText: buildSearchText(doc) };
}

async function seed() {
  await MedicalCode.insertMany([
    // Один и тот же код в двух системах — это разные вещи.
    makeDoc({
      system: CODE_SYSTEMS.ICD9CM_SG,
      code: "28.2",
      en: "Tonsillectomy without adenoidectomy",
    }),
    makeDoc({
      system: CODE_SYSTEMS.ICD10CM,
      code: "J35.01",
      en: "Chronic tonsillitis",
    }),
    makeDoc({
      system: CODE_SYSTEMS.ICD9CM_SG,
      code: "28",
      en: "Operations on tonsils and adenoids",
      isBillable: false,
    }),
  ]);
}

describe("коды вмешательств", () => {
  beforeEach(async () => {
    resetSearchStrategy();
    await seed();
  });

  it("фильтр по системе отдаёт только вмешательства", async () => {
    const { items } = await searchCodes({
      query: "tonsil",
      system: CODE_SYSTEMS.ICD9CM_SG,
    });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.system === CODE_SYSTEMS.ICD9CM_SG)).toBe(true);
  });

  it("фильтр по болезням не пропускает операции", async () => {
    const { items } = await searchCodes({
      query: "tonsil",
      system: CODE_SYSTEMS.ICD10CM,
    });
    expect(items.every((i) => i.system === CODE_SYSTEMS.ICD10CM)).toBe(true);
  });

  it("без фильтра находит и болезни, и вмешательства", async () => {
    const { items } = await searchCodes({ query: "tonsil" });
    const systems = new Set(items.map((i) => i.system));
    expect(systems.size).toBeGreaterThan(1);
  });

  it("точное получение различает системы для одного кода", async () => {
    await MedicalCode.create(
      makeDoc({
        system: CODE_SYSTEMS.ICD10CM,
        code: "28.2",
        en: "Something completely different",
      }),
    );

    const procedure = await getCode({
      code: "28.2",
      system: CODE_SYSTEMS.ICD9CM_SG,
    });
    const disease = await getCode({
      code: "28.2",
      system: CODE_SYSTEMS.ICD10CM,
    });

    expect(procedure.titleEn).toBe("Tonsillectomy without adenoidectomy");
    expect(disease.titleEn).toBe("Something completely different");
  });

  it("раздел номенклатуры помечен как непригодный для записи", async () => {
    const section = await getCode({
      code: "28",
      system: CODE_SYSTEMS.ICD9CM_SG,
    });
    expect(section.isBillable).toBe(false);
  });

  it("список систем вмешательств не включает системы болезней", () => {
    expect(INTERVENTION_SYSTEMS).toContain(CODE_SYSTEMS.ICD9CM_SG);
    expect(INTERVENTION_SYSTEMS).not.toContain(CODE_SYSTEMS.ICD10CM);
  });
});

describe("код вмешательства в записи об операции", () => {
  const baseCase = () => ({
    surgeonId: new mongoose.Types.ObjectId(),
    patientType: "private",
    procedure: "rhinoplasty",
  });

  it("сохраняется вместе с системой и названием", async () => {
    const created = await SurgicalCase.create({
      ...baseCase(),
      interventionCode: {
        system: CODE_SYSTEMS.ICD9CM_SG,
        code: "21.87",
        codeTitle: "Other rhinoplasty",
      },
    });

    const saved = await SurgicalCase.findById(created._id).lean();
    expect(saved.interventionCode.system).toBe(CODE_SYSTEMS.ICD9CM_SG);
    expect(saved.interventionCode.code).toBe("21.87");
    expect(saved.interventionCode.codeTitle).toBe("Other rhinoplasty");
  });

  it("необязателен — операцию можно завести без кода", async () => {
    const created = await SurgicalCase.create(baseCase());
    const saved = await SurgicalCase.findById(created._id).lean();
    expect(saved.interventionCode.code).toBe("");
  });

  it("не подменяет внутреннюю классификацию procedure", async () => {
    // procedure — наша группировка, interventionCode — международная
    // отчётность. Одно не должно перезаписывать другое.
    const created = await SurgicalCase.create({
      ...baseCase(),
      procedure: "otoplasty",
      interventionCode: {
        system: CODE_SYSTEMS.ICD9CM_SG,
        code: "18.5",
        codeTitle: "Surgical correction of prominent ear",
      },
    });

    const saved = await SurgicalCase.findById(created._id).lean();
    expect(saved.procedure).toBe("otoplasty");
    expect(saved.interventionCode.code).toBe("18.5");
  });

  it("название кода хранится в записи, а не берётся из справочника на лету", async () => {
    // Номенклатуры пересматриваются. Запись об операции должна сохранить ту
    // формулировку, которую видел врач, когда её подписывал.
    const created = await SurgicalCase.create({
      ...baseCase(),
      interventionCode: {
        system: CODE_SYSTEMS.ICD9CM_SG,
        code: "28.2",
        codeTitle: "Tonsillectomy without adenoidectomy",
      },
    });

    // Справочник переименовали.
    await MedicalCode.updateOne(
      { system: CODE_SYSTEMS.ICD9CM_SG, code: "28.2" },
      { $set: { "titles.en": "ПЕРЕИМЕНОВАНО" } },
    );

    const saved = await SurgicalCase.findById(created._id).lean();
    expect(saved.interventionCode.codeTitle).toBe(
      "Tonsillectomy without adenoidectomy",
    );
  });
});
