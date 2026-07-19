// __tests__/encounter/encounter-phi-encryption.test.js
//
// Шифрование PHI encounter-модели (newPatientMedicalHistory): поля хранятся
// зашифрованными at-rest, читаются расшифрованными; lean — через decryptFields.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import Encounter from "../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";
import { isEncrypted } from "../../common/utils/phiCrypto.js";

const oid = () => new mongoose.Types.ObjectId();

async function makeEncounter(overrides = {}) {
  return Encounter.create({
    createdBy: oid(),
    patientType: "registered",
    patientRef: oid(),
    patientTypeModel: "NewPatientPolyclinic",
    complaints: "Головная боль и тошнота",
    anamnesisMorbi: "Болеет 3 дня",
    recommendations: "Покой, обильное питьё",
    mainDiagnosis: { code: "R51", codeTitle: "Headache", text: "Мигрень" },
    additionalDiagnosis: "Гипертония",
    ...overrides,
  });
}

describe("encounter PHI encryption", () => {
  it("в БД поля хранятся зашифрованными (at-rest)", async () => {
    const doc = await makeEncounter();
    const raw = await Encounter.collection.findOne({ _id: doc._id });

    expect(isEncrypted(raw.complaints)).toBe(true);
    expect(raw.complaints).not.toBe("Головная боль и тошнота");
    expect(isEncrypted(raw.anamnesisMorbi)).toBe(true);
    expect(isEncrypted(raw.mainDiagnosis.text)).toBe(true);
    expect(isEncrypted(raw.additionalDiagnosis)).toBe(true);
    // code/codeTitle — НЕ PHI, не шифруются.
    expect(raw.mainDiagnosis.code).toBe("R51");
    expect(raw.mainDiagnosis.codeTitle).toBe("Headache");
  });

  it("чтение через модель (геттеры) возвращает расшифрованный текст", async () => {
    const doc = await makeEncounter();
    const loaded = await Encounter.findById(doc._id);
    expect(loaded.complaints).toBe("Головная боль и тошнота");
    expect(loaded.recommendations).toBe("Покой, обильное питьё");
    expect(loaded.mainDiagnosis.text).toBe("Мигрень");
    // toJSON тоже расшифровывает (getters:true)
    expect(loaded.toJSON().complaints).toBe("Головная боль и тошнота");
  });

  it("lean-чтение автоматически расшифровывается post-find хуком", async () => {
    const doc = await makeEncounter();
    const lean = await Encounter.findById(doc._id).lean();
    // хук расшифровал lean-результат — шифротекст не утёк
    expect(lean.complaints).toBe("Головная боль и тошнота");
    expect(lean.additionalDiagnosis).toBe("Гипертония");
    expect(lean.mainDiagnosis.text).toBe("Мигрень");
    // но в БД по-прежнему зашифровано (at-rest)
    const raw = await Encounter.collection.findOne({ _id: doc._id });
    expect(isEncrypted(raw.complaints)).toBe(true);

    // find (массив) тоже расшифровывается
    const list = await Encounter.find({ _id: doc._id }).lean();
    expect(list[0].complaints).toBe("Головная боль и тошнота");
  });

  it("зеркало diagnosis синхронно с mainDiagnosis.text и расшифровывается", async () => {
    const doc = await makeEncounter();
    const loaded = await Encounter.findById(doc._id);
    expect(loaded.diagnosis).toBe("Мигрень");
  });

  it("findOneAndUpdate шифрует PHI в $set (setters обходятся)", async () => {
    const doc = await makeEncounter();
    await Encounter.findByIdAndUpdate(doc._id, {
      $set: { complaints: "Новая жалоба" },
    });
    const raw = await Encounter.collection.findOne({ _id: doc._id });
    expect(isEncrypted(raw.complaints)).toBe(true);
    expect(raw.complaints).not.toBe("Новая жалоба");
    const loaded = await Encounter.findById(doc._id);
    expect(loaded.complaints).toBe("Новая жалоба");
  });

  it("повторное сохранение не портит данные (идемпотентность)", async () => {
    const doc = await makeEncounter();
    const loaded = await Encounter.findById(doc._id);
    loaded.recommendations = "Обновлённые рекомендации";
    await loaded.save();
    const again = await Encounter.findById(doc._id);
    expect(again.recommendations).toBe("Обновлённые рекомендации");
    expect(again.complaints).toBe("Головная боль и тошнота"); // не тронуто
    const raw = await Encounter.collection.findOne({ _id: doc._id });
    expect(isEncrypted(raw.recommendations)).toBe(true);
  });
});
