// __tests__/radiology/featuredCaseLanguage.test.js
//
// «КЕЙС ДНЯ» И «КЕЙС НЕДЕЛИ» — на языке врача.
//
// Витрина станции отдаёт кейсы переведёнными (case.service →
// translateCaseList), а эти две карточки шли мимо слоя переводов и брали
// title прямо из документа. В азербайджанском интерфейсе карточка сверху
// была русской, а тот же самый кейс в сетке ниже — переведённым: одна
// страница, один кейс, два языка.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import RadiologyCase from "../../modules/radiology/radiology-cases/models/radiologyCase.model.js";
import ArenaCaseTranslation from "../../modules/radiology/translation/arenaCaseTranslation.model.js";
import {
  getDailyCase,
  getWeeklyCase,
} from "../../modules/radiology/game/game.service.js";

const RU_TITLE = "КТ височных костей: отоспонгиозные очаги капсулы лабиринта";
const AZ_TITLE = "Gicgah sümüklərinin KT-si: labirint kapsulunun otospongioz ocaqları";

async function makeCase() {
  return RadiologyCase.create({
    modality: "ct",
    title: RU_TITLE,
    clinicalContext: "Прогрессирующее снижение слуха.",
    difficulty: "hard",
    images: [{ url: "https://example.test/1.jpg", order: 0 }],
    findings: [
      {
        key: "otosp",
        imageIndex: 0,
        label: "otospongiosis",
        significance: "major",
        geometry: { shape: "rect", coords: { x: 1, y: 1, w: 10, h: 10 } },
        explanation: "Очаг разрежения кпереди от овального окна.",
      },
    ],
    impression: {
      correctText: "Отоспонгиоз капсулы лабиринта.",
      diagnosisKeys: ["отоспонгиоз"],
    },
    source: { kind: "original" },
    status: "published",
  });
}

let caseDoc;

beforeEach(async () => {
  caseDoc = await makeCase();
  await ArenaCaseTranslation.create({
    caseType: "radiology",
    caseId: caseDoc._id,
    lang: "az",
    status: "auto",
    fields: [{ path: "title", text: AZ_TITLE }],
    diagnosisKeys: ["otospongioz"],
    model: "test-model",
    promptVersion: "test",
    sourceHash: "test",
  });
});

describe("язык избранного кейса", () => {
  it("кейс дня приходит переведённым", async () => {
    const daily = await getDailyCase("az");
    expect(daily.title).toBe(AZ_TITLE);
  });

  it("кейс недели приходит переведённым", async () => {
    const weekly = await getWeeklyCase("az");
    expect(weekly.title).toBe(AZ_TITLE);
  });

  it("без языка отдаётся оригинал — рассылка ходит без запроса", async () => {
    // jobs/radiologyWeeklyCase зовёт getWeeklyCase() без аргумента.
    const weekly = await getWeeklyCase();
    expect(weekly.title).toBe(RU_TITLE);
  });

  it("перевода на этот язык нет — отдаём оригинал, а не пустоту", async () => {
    const daily = await getDailyCase("tr");
    expect(daily.title).toBe(RU_TITLE);
  });

  it("миниатюра и сложность не теряются при подмене перевода", async () => {
    const daily = await getDailyCase("az");
    expect(daily.thumb).toBe("https://example.test/1.jpg");
    expect(daily.difficulty).toBe("hard");
    expect(String(daily._id)).toBe(String(caseDoc._id));
  });
});
