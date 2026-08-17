// __tests__/doctorsProfiles/competence.test.js
//
// Подтверждённая учебная активность врача.
//
// Это данные о человеке, которые видит пациент, выбирая врача. Отсюда
// три требования, и все три проверяются здесь:
//
//   1. НЕ ПОКАЗЫВАЕТСЯ БЕЗ СОГЛАСИЯ. Автоматическая публикация точности
//      наказывает того, кто тренируется и ошибается, — то есть ровно
//      того, ради кого тренажёр сделан.
//   2. ПРОЦЕНТ ТОЛЬКО ПРИ ОБЪЁМЕ. Точность по трём случаям — шум:
//      одна ошибка меняет её на треть.
//   3. ПУСТОЙ ПРОФИЛЬ НЕ ПОКАЗЫВАЕТСЯ ВОВСЕ. Нули читаются как «врач
//      ничего не делает», хотя он мог просто не пользоваться тренажёром.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import RadiologyAttempt from "../../modules/radiology/radiology-attempts/models/radiologyAttempt.model.js";
import User from "../../common/models/Auth/users.js";
import {
  getCompetence,
  setCompetenceVisibility,
  MIN_CASES_FOR_ACCURACY,
} from "../../modules/doctorsProfiles/services/competence.service.js";
import { createTestDoctor } from "../helpers/createTestUser.js";

const oid = () => new mongoose.Types.ObjectId();

async function attempts(userId, count, score) {
  const docs = [];
  for (let i = 0; i < count; i += 1) {
    docs.push({
      userId,
      caseId: oid(),
      status: "submitted",
      score: { total: score, passed: score >= 0.7 },
    });
  }
  await RadiologyAttempt.insertMany(docs);
}

describe("учебная активность врача", () => {
  let doctor;

  beforeEach(async () => {
    const made = await createTestDoctor();
    doctor = made.user;
  });

  it("без согласия врача не показывается никому", async () => {
    await attempts(doctor._id, MIN_CASES_FOR_ACCURACY, 0.8);

    const publicView = await getCompetence(doctor._id);
    expect(publicView).toBeNull();

    // Себе врач видит всегда — иначе он не может решить, показывать ли.
    const ownView = await getCompetence(doctor._id, { forSelf: true });
    expect(ownView.radiology.cases).toBe(MIN_CASES_FOR_ACCURACY);
  });

  it("после включения показывается публично", async () => {
    await attempts(doctor._id, MIN_CASES_FOR_ACCURACY, 0.8);
    await setCompetenceVisibility(doctor._id, true);

    const publicView = await getCompetence(doctor._id);
    expect(publicView.enabled).toBe(true);
    expect(publicView.radiology.accuracy).toBe(80);
  });

  it("процент не показывается, пока случаев мало", async () => {
    await attempts(doctor._id, 3, 0.9);
    await setCompetenceVisibility(doctor._id, true);

    const view = await getCompetence(doctor._id);
    // Активность есть, а процента нет: по трём случаям он скачет на
    // треть от одной ошибки, и такая цифра хуже её отсутствия.
    expect(view.radiology.cases).toBe(3);
    expect(view.radiology.accuracy).toBeNull();
  });

  it("врач без активности не показывается вовсе", async () => {
    await setCompetenceVisibility(doctor._id, true);

    const view = await getCompetence(doctor._id);
    // Нули читались бы как «ничего не делает», хотя тренажёр может
    // просто не относиться к его работе.
    expect(view).toBeNull();
  });

  it("незавершённые попытки не считаются", async () => {
    await RadiologyAttempt.insertMany(
      Array.from({ length: 5 }, () => ({
        userId: doctor._id,
        caseId: oid(),
        status: "in_progress",
        score: { total: 0, passed: false },
      })),
    );
    await setCompetenceVisibility(doctor._id, true);

    const view = await getCompetence(doctor._id);
    // Брошенная на середине попытка — не разобранный случай.
    expect(view).toBeNull();
  });

  it("подпись говорит, чем эти цифры НЕ являются", async () => {
    await attempts(doctor._id, MIN_CASES_FOR_ACCURACY, 0.75);
    await setCompetenceVisibility(doctor._id, true);

    const view = await getCompetence(doctor._id);
    // Формулировка приходит с сервера: это утверждение о человеке, и
    // оно не должно зависеть от экрана, который его показывает.
    expect(view.caption).toMatch(/не оценка клинической квалификации/i);
  });

  it("не врачу активность не считается", async () => {
    const { user: patient } = await createTestDoctor({ role: "patient" });
    await User.updateOne(
      { _id: patient._id },
      { $set: { "publicCompetence.enabled": true } },
    );
    await attempts(patient._id, MIN_CASES_FOR_ACCURACY, 0.9);

    expect(await getCompetence(patient._id, { forSelf: true })).toBeNull();
  });
});
