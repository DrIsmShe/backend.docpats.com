// __tests__/clinic-medical/patientSummary.test.js
//
// Сводка пациента — один экран вместо двенадцати вкладок.
//
// Проверяем три вещи, и все три существенны:
//
//   1. НИЧЕГО НЕ ВЫДУМЫВАЕТ. Каждая строка сводки — это поле записи.
//      Раздел, в котором записей нет, остаётся пустым: «без
//      особенностей» в карте, где врач ничего не писал, опаснее пустоты.
//
//   2. НЕ ПОКАЗЫВАЕТ ЧУЖОЕ. Сводка отдаёт больше сведений одним
//      движением, чем любой отдельный список, поэтому требования к
//      изоляции у неё выше, а не ниже.
//
//   3. ОТКЛОНЕНИЯ ВИДНЫ ПЕРВЫМИ. Ради этого экран и делался: врач
//      читает сверху и должен упереться в важное, а не искать его.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { runWithTenantContext } from "../../common/context/tenantContext.js";
import allergyService from "../../modules/clinic/clinic-medical/services/allergy.service.js";
import chronicService from "../../modules/clinic/clinic-medical/services/chronic.service.js";
import LabResult from "../../modules/clinic/clinic-medical/models/labResult.model.js";
import { getPatientSummary } from "../../modules/clinic/clinic-medical/services/patientSummary.service.js";

const oid = () => new mongoose.Types.ObjectId();

function ctx(clinicId, userId = oid()) {
  return {
    userId: String(userId),
    clinicId: String(clinicId),
    role: "doctor",
    actorType: "user",
  };
}

/** Панель анализов напрямую в модель: сервис создания требует multipart. */
async function makeLab({ clinicId, patientId, params, daysAgo = 0 }) {
  return LabResult.create({
    patientRef: patientId,
    patientTypeModel: "ClinicPatient",
    createdByClinicId: clinicId,
    createdBy: oid(),
    panelType: "BloodTestGeneral",
    panelTitle: "Общий анализ крови",
    status: "final",
    effectiveDateTime: new Date(Date.now() - daysAgo * 864e5),
    parameters: params,
  });
}

describe("сводка пациента", () => {
  it("пустая карта даёт пустые разделы, а не выдуманные «без особенностей»", async () => {
    const clinicId = oid();
    const patient = { _id: oid() };

    const summary = await runWithTenantContext(ctx(clinicId), () =>
      getPatientSummary({ patient }),
    );

    expect(summary.allergies).toEqual([]);
    expect(summary.chronic).toEqual([]);
    expect(summary.labs.abnormal).toEqual([]);
    expect(summary.encounters).toEqual([]);
  });

  it("собирает разделы из тех же сервисов, что и обычные списки", async () => {
    const clinicId = oid();
    const patient = { _id: oid() };
    const context = ctx(clinicId);

    await runWithTenantContext(context, async () => {
      await allergyService.create({
        patient,
        body: { content: "Пенициллин — анафилаксия" },
      });
      await chronicService.create({
        patient,
        body: { content: "Гипертоническая болезнь II ст." },
      });
    });

    const summary = await runWithTenantContext(context, () =>
      getPatientSummary({ patient }),
    );

    expect(summary.allergies).toHaveLength(1);
    expect(summary.allergies[0].content).toBe("Пенициллин — анафилаксия");
    expect(summary.chronic).toHaveLength(1);
  });

  it("чужая клиника без согласия не видит НИЧЕГО", async () => {
    const ownerClinic = oid();
    const foreignClinic = oid();
    const patient = { _id: oid() };

    await runWithTenantContext(ctx(ownerClinic), () =>
      allergyService.create({ patient, body: { content: "Йод" } }),
    );

    const summary = await runWithTenantContext(ctx(foreignClinic), () =>
      getPatientSummary({ patient }),
    );

    // Сводка показывает всю карту разом — если бы изоляция здесь
    // протекала, утекала бы вся карта целиком, а не одна запись.
    expect(summary.allergies).toEqual([]);
    expect(summary.chronic).toEqual([]);
  });

  it("отклонения отделены от нормы и идут первыми", async () => {
    const clinicId = oid();
    const patient = { _id: oid() };

    await makeLab({
      clinicId,
      patientId: patient._id,
      params: [
        {
          name: "Гемоглобин",
          loincCode: "718-7",
          valueType: "number",
          value: 98,
          unit: "г/л",
          referenceRange: { min: 120, max: 160 },
          flag: "low",
        },
        {
          name: "Лейкоциты",
          loincCode: "6690-2",
          valueType: "number",
          value: 6.1,
          unit: "10^9/л",
          referenceRange: { min: 4, max: 9 },
          flag: "normal",
        },
      ],
    });

    const summary = await runWithTenantContext(ctx(clinicId), () =>
      getPatientSummary({ patient }),
    );

    expect(summary.labs.abnormal).toHaveLength(1);
    expect(summary.labs.abnormal[0].name).toBe("Гемоглобин");
    // Первым в общем списке тоже отклонение: врач читает сверху.
    expect(summary.labs.all[0].name).toBe("Гемоглобин");
  });

  it("критическое значение идёт выше обычного отклонения", async () => {
    const clinicId = oid();
    const patient = { _id: oid() };

    await makeLab({
      clinicId,
      patientId: patient._id,
      params: [
        {
          name: "СОЭ",
          loincCode: "4537-7",
          valueType: "number",
          value: 22,
          unit: "мм/ч",
          referenceRange: { min: 2, max: 15 },
          flag: "high",
        },
        {
          name: "Калий",
          loincCode: "2823-3",
          valueType: "number",
          value: 7.2,
          unit: "ммоль/л",
          referenceRange: { min: 3.5, max: 5.1 },
          flag: "critical_high",
        },
      ],
    });

    const summary = await runWithTenantContext(ctx(clinicId), () =>
      getPatientSummary({ patient }),
    );

    // Разница между «слегка повышен» и «критически повышен» — это
    // разница между «учесть» и «звонить пациенту».
    expect(summary.labs.all[0].name).toBe("Калий");
    expect(summary.labs.all[0].isCritical).toBe(true);
  });

  it("показывает динамику показателя между двумя сдачами", async () => {
    const clinicId = oid();
    const patient = { _id: oid() };

    await makeLab({
      clinicId,
      patientId: patient._id,
      daysAgo: 60,
      params: [
        {
          name: "Гемоглобин",
          loincCode: "718-7",
          valueType: "number",
          value: 90,
          unit: "г/л",
          referenceRange: { min: 120, max: 160 },
          flag: "low",
        },
      ],
    });
    await makeLab({
      clinicId,
      patientId: patient._id,
      daysAgo: 1,
      params: [
        {
          name: "Гемоглобин",
          loincCode: "718-7",
          valueType: "number",
          value: 105,
          unit: "г/л",
          referenceRange: { min: 120, max: 160 },
          flag: "low",
        },
      ],
    });

    const summary = await runWithTenantContext(ctx(clinicId), () =>
      getPatientSummary({ patient }),
    );

    const hb = summary.labs.all.find((i) => i.name === "Гемоглобин");
    expect(hb.value).toBe(105); // последнее значение, а не первое найденное
    expect(hb.trend.direction).toBe("up");
    expect(hb.trend.previous).toBe(90);
  });

  it("показатель сопоставляется по LOINC, а не по названию", async () => {
    const clinicId = oid();
    const patient = { _id: oid() };

    // «HGB» и «Гемоглобин» — один показатель. По названию они не
    // совпадут, и динамика потерялась бы.
    await makeLab({
      clinicId,
      patientId: patient._id,
      daysAgo: 30,
      params: [
        {
          name: "HGB",
          loincCode: "718-7",
          valueType: "number",
          value: 100,
          unit: "г/л",
          flag: "low",
        },
      ],
    });
    await makeLab({
      clinicId,
      patientId: patient._id,
      daysAgo: 1,
      params: [
        {
          name: "Гемоглобин",
          loincCode: "718-7",
          valueType: "number",
          value: 130,
          unit: "г/л",
          flag: "normal",
        },
      ],
    });

    const summary = await runWithTenantContext(ctx(clinicId), () =>
      getPatientSummary({ patient }),
    );

    const hb = summary.labs.all.filter((i) => i.loincCode === "718-7");
    expect(hb).toHaveLength(1); // не размножился на два показателя
    expect(hb[0].trend.previous).toBe(100);
  });
});
