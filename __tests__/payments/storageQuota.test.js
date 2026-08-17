// __tests__/payments/storageQuota.test.js
//
// Квота архива документов.
//
// Ключевое решение, которое здесь закреплено: квота считается с ТОГО,
// КТО ЗАГРУЖАЕТ — с врача. Пациент файлы не загружает вовсе, записи
// вносит врач, у которого он наблюдается. Лимит на пациенте означал бы
// «врач не может приложить снимок, потому что его пациент на бесплатном
// тарифе» — блокировку врача посреди приёма из-за чужой подписки.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import StoredFile from "../../common/models/storedFile.js";
import User from "../../common/models/Auth/users.js";
import {
  assertStorageAllowed,
  recordStoredFiles,
  releaseStoredFile,
  storageQuotaLeft,
  storedFilesUsed,
} from "../../common/services/storageQuota.service.js";
import { PLAN_LIMITS } from "../../common/config/aiPlanLimits.js";

let counter = 0;

async function makeUser(role, plan) {
  counter += 1;
  const suffix = `${Date.now()}-${counter}`;
  return User.create({
    emailEncrypted: `sq-${suffix}@example.com`,
    firstNameEncrypted: "Тест",
    lastNameEncrypted: "Пользователь",
    emailHash: `h-${suffix}`,
    firstNameHash: "placeholder",
    lastNameHash: "placeholder",
    username: `sq_${suffix}`.replace(/[^a-z0-9_]/gi, ""),
    password: "hashed-password-placeholder",
    dateOfBirth: new Date("1980-01-01"),
    bio: "test",
    agreement: true,
    role,
    subscriptionPlan: plan,
    trialEndsAt: new Date(Date.now() - 86400000),
  });
}

/** Занять n мест в архиве. */
async function fill(ownerId, n) {
  await StoredFile.insertMany(
    Array.from({ length: n }, (_, i) => ({
      ownerId,
      url: `https://r2.example/${ownerId}-${i}-${Math.random()}`,
      size: 1000,
      context: "study",
    })),
  );
}

describe("квота архива документов", () => {
  let doctor;

  beforeEach(async () => {
    doctor = await makeUser("doctor", "doctor_lite");
  });

  it("в пределах тарифа загрузка разрешена", async () => {
    await fill(doctor._id, 10);
    await expect(assertStorageAllowed(doctor._id, 1)).resolves.toBeUndefined();
  });

  it("на пределе отказывает и называет тариф", async () => {
    await fill(doctor._id, PLAN_LIMITS.doctor_lite.storedFiles);

    await expect(assertStorageAllowed(doctor._id, 1)).rejects.toThrow(/архив/i);
    await expect(assertStorageAllowed(doctor._id, 1)).rejects.toThrow(
      /Doctor Lite/,
    );
  });

  it("пачка проверяется целиком: три из пяти хуже, чем отказ сразу", async () => {
    const limit = PLAN_LIMITS.doctor_lite.storedFiles;
    await fill(doctor._id, limit - 2);

    // Два поместятся, пять — нет. Частично загруженное исследование
    // выглядит как потерянные данные.
    await expect(assertStorageAllowed(doctor._id, 2)).resolves.toBeUndefined();
    await expect(assertStorageAllowed(doctor._id, 5)).rejects.toThrow();
  });

  it("пациенту квота не применяется: он файлы не загружает", async () => {
    const patient = await makeUser("patient", "patient_free");
    await fill(patient._id, 5000);

    await expect(assertStorageAllowed(patient._id, 10)).resolves.toBeUndefined();
    const left = await storageQuotaLeft(patient._id);
    expect(left.limit).toBeNull();
  });

  it("удалённый файл освобождает место", async () => {
    const limit = PLAN_LIMITS.doctor_lite.storedFiles;
    await fill(doctor._id, limit);
    const one = await StoredFile.findOne({ ownerId: doctor._id });

    await expect(assertStorageAllowed(doctor._id, 1)).rejects.toThrow();

    const freed = await releaseStoredFile(one.url);
    expect(freed).toBe(1);
    await expect(assertStorageAllowed(doctor._id, 1)).resolves.toBeUndefined();
  });

  it("запись об освобождённом файле остаётся: она нужна уборщику сирот", async () => {
    await recordStoredFiles(doctor._id, [
      { fileUrl: "https://r2.example/x", fileSize: 10, fileName: "x.pdf" },
    ]);
    await releaseStoredFile("https://r2.example/x");

    expect(await storedFilesUsed(doctor._id)).toBe(0);
    expect(await StoredFile.countDocuments({ ownerId: doctor._id })).toBe(1);
  });

  it("реестр пишет размер: он понадобится при переходе на гигабайты", async () => {
    await recordStoredFiles(doctor._id, [
      { fileUrl: "https://r2.example/ct", fileSize: 524288, fileFormat: "image/dicom" },
    ]);
    const rec = await StoredFile.findOne({ ownerId: doctor._id }).lean();

    expect(rec.size).toBe(524288);
    expect(rec.mime).toBe("image/dicom");
  });

  it("чужие файлы в квоту не попадают", async () => {
    const other = await makeUser("doctor", "doctor_lite");
    await fill(other._id, PLAN_LIMITS.doctor_lite.storedFiles);

    await expect(assertStorageAllowed(doctor._id, 1)).resolves.toBeUndefined();
  });

  it("без владельца не падает: служебная загрузка должна проходить", async () => {
    await expect(assertStorageAllowed(null, 3)).resolves.toBeUndefined();
    expect(await recordStoredFiles(null, [{ fileUrl: "x" }])).toEqual([]);
  });
});
