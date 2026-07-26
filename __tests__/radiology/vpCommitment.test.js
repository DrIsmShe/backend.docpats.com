// __tests__/radiology/vpCommitment.test.js
//
// Предварительная фиксация дифдиагноза на станции «Виртуальный пациент».
//
// Это главный из доступных нам способов измерить знание самого врача, а не
// его доступ к чат-боту: версию нужно назвать по жалобе и анамнезу, до
// результатов обследований. Чужая модель на таком входе почти не помогает —
// у неё нет ни данных, ни возможности назначить исследование.
//
// Поэтому проверяем три свойства:
//   • в зачёте нельзя заказать обследование, не назвав свою версию;
//   • фиксация одноразовая — переписать её, увидев результаты, нельзя;
//   • ответ на фиксацию НЕ содержит обратной связи, иначе это подсказка.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import VirtualPatientCase from "../../modules/radiology/virtual-patient/models/vpCase.model.js";
import {
  startVpAttempt,
  commitDifferential,
  orderInvestigation,
  submitVpAttempt,
} from "../../modules/radiology/virtual-patient/vp.service.js";

const userId = new mongoose.Types.ObjectId();

async function makeCase() {
  return VirtualPatientCase.create({
    title: "Женщина 28 лет с болью в суставах",
    presentation: "Утренняя скованность более часа, симметричный полиартрит кистей",
    investigations: [
      { key: "rf", name: "Ревматоидный фактор", resultText: "положительный", necessary: true },
      { key: "accp", name: "Анти-ЦЦП", resultText: "резко положительный", necessary: true },
      { key: "xray", name: "Рентген кистей", resultText: "краевые эрозии", necessary: true },
      { key: "ct_head", name: "КТ головы", resultText: "без патологии", necessary: false },
    ],
    diagnosis: {
      correctText: "Ревматоидный артрит",
      diagnosisKeys: ["ревматоидный артрит"],
      diagnosisSynonyms: ["ра"],
    },
    source: { kind: "original" },
    status: "published",
  });
}

let vpCase;
beforeEach(async () => {
  vpCase = await makeCase();
});

describe("порядок работы в зачёте", () => {
  it("без предварительной версии обследование не заказать", async () => {
    const { attempt } = await startVpAttempt(vpCase._id, userId, "exam");
    await expect(orderInvestigation(attempt._id, userId, "rf")).rejects.toThrow(
      /предварительный дифдиагноз/i,
    );
  });

  it("после фиксации заказы разрешены и попадают в путь решения", async () => {
    const { attempt } = await startVpAttempt(vpCase._id, userId, "exam");
    await commitDifferential(attempt._id, userId, "Ревматоидный артрит, реактивный артрит");

    const inv = await orderInvestigation(attempt._id, userId, "rf");
    expect(inv.resultText).toBe("положительный");

    const { attempt: done } = await submitVpAttempt(attempt._id, userId, {
      diagnosisText: "Ревматоидный артрит",
    });
    expect(done.response.orderLog).toHaveLength(1);
    expect(done.response.orderLog[0]).toMatchObject({ key: "rf", necessary: true });
  });

  it("в тренировке порядок не навязывается — заказывать можно сразу", async () => {
    const { attempt } = await startVpAttempt(vpCase._id, userId, "learn");
    const inv = await orderInvestigation(attempt._id, userId, "rf");
    expect(inv.name).toBe("Ревматоидный фактор");
  });
});

describe("фиксация одноразовая и без подсказок", () => {
  it("ответ не говорит, угадал ли врач", async () => {
    const { attempt } = await startVpAttempt(vpCase._id, userId, "exam");
    const res = await commitDifferential(attempt._id, userId, "Ревматоидный артрит");
    expect(res.committedAt).toBeTruthy();
    expect(res).not.toHaveProperty("hit");
    expect(res).not.toHaveProperty("matched");
  });

  it("переписать версию после результатов нельзя", async () => {
    const { attempt } = await startVpAttempt(vpCase._id, userId, "exam");
    await commitDifferential(attempt._id, userId, "Реактивный артрит");
    await orderInvestigation(attempt._id, userId, "accp");
    await expect(
      commitDifferential(attempt._id, userId, "Ревматоидный артрит"),
    ).rejects.toThrow(/уже зафиксирован/i);
  });

  it("фиксация запоминает, сколько обследований было раскрыто до неё", async () => {
    const { attempt } = await startVpAttempt(vpCase._id, userId, "learn");
    await orderInvestigation(attempt._id, userId, "rf");
    await orderInvestigation(attempt._id, userId, "accp");
    const res = await commitDifferential(attempt._id, userId, "Ревматоидный артрит");
    // «Назвал по жалобе» и «назвал, посмотрев анализы» — разные вещи, и в
    // разборе это должно быть видно.
    expect(res.orderedBefore).toBe(2);
  });
});

describe("оценка предварительной версии", () => {
  it("верная версия по жалобе даёт полный компонент prior", async () => {
    const { attempt } = await startVpAttempt(vpCase._id, userId, "exam");
    await commitDifferential(attempt._id, userId, "Ревматоидный артрит");
    for (const k of ["rf", "accp", "xray"]) await orderInvestigation(attempt._id, userId, k);

    const { attempt: done, review } = await submitVpAttempt(attempt._id, userId, {
      diagnosisText: "Ревматоидный артрит, серопозитивный, эрозивная форма",
    });
    expect(done.score.prior).toBe(1);
    expect(review.commitment).toMatchObject({ hit: true });
  });

  it("перебор из десятка диагнозов — половина, а не полный балл", async () => {
    const { attempt } = await startVpAttempt(vpCase._id, userId, "exam");
    await commitDifferential(
      attempt._id,
      userId,
      "ревматоидный артрит, реактивный артрит, псориатический артрит, СКВ, " +
        "остеоартроз, подагра, фибромиалгия, болезнь Лайма",
    );
    const { attempt: done } = await submitVpAttempt(attempt._id, userId, {
      diagnosisText: "Ревматоидный артрит",
    });
    expect(done.score.prior).toBe(0.5);
  });

  it("неверная версия — ноль, но итог по кейсу не обнуляется", async () => {
    const { attempt } = await startVpAttempt(vpCase._id, userId, "exam");
    await commitDifferential(attempt._id, userId, "Подагра");
    for (const k of ["rf", "accp", "xray"]) await orderInvestigation(attempt._id, userId, k);

    const { attempt: done } = await submitVpAttempt(attempt._id, userId, {
      diagnosisText: "Ревматоидный артрит",
    });
    expect(done.score.prior).toBe(0);
    expect(done.score.diagnosis).toBe(1);
    expect(done.score.total).toBeGreaterThan(0.5);
  });

  it("без фиксации компонент исключается из нормировки, а не занижает балл", async () => {
    const { attempt } = await startVpAttempt(vpCase._id, userId, "learn");
    for (const k of ["rf", "accp", "xray"]) await orderInvestigation(attempt._id, userId, k);
    const { attempt: done, review } = await submitVpAttempt(attempt._id, userId, {
      diagnosisText: "Ревматоидный артрит",
      reasoningText: "Симметричный полиартрит, положительные РФ и анти-ЦЦП, эрозии",
    });
    expect(done.score.prior).toBeNull();
    expect(review.commitment).toBeNull();
    expect(done.score.total).toBeGreaterThan(0.8); // не наказан за отсутствие версии
  });
});
