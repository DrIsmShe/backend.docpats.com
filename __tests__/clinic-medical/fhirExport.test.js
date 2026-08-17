// __tests__/clinic-medical/fhirExport.test.js
//
// Выгрузка карты в FHIR R4.
//
// Что проверяем и почему именно это:
//
//   1. НИЧЕГО НЕ ВЫДУМАНО. Поля, которых в наших записях нет, остаются
//      пустыми. Подставленное «active» принимающая система прочтёт как
//      факт из карты — а его никто не утверждал.
//
//   2. КОДЫ ПЕРЕНОСЯТСЯ. Ради LOINC и МКБ выгрузка и делается: по коду
//      принимающая сторона поймёт, что «HGB» и «Гемоглобин» — один
//      показатель, а по названию не поймёт.
//
//   3. ИДЕНТИФИКАТОРЫ УСТОЙЧИВЫ. Повторная выгрузка не должна создавать
//      дубли на приёмной стороне.
//
//   4. ИЗОЛЯЦИЯ. Выгрузка кладёт ВСЮ карту в файл — утечка здесь стоит
//      дороже, чем в любом отдельном списке.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { runWithTenantContext } from "../../common/context/tenantContext.js";
import allergyService from "../../modules/clinic/clinic-medical/services/allergy.service.js";
import LabResult from "../../modules/clinic/clinic-medical/models/labResult.model.js";
import { exportPatientAsFhir } from "../../modules/clinic/clinic-medical/services/fhir/fhirExport.service.js";
import * as map from "../../modules/clinic/clinic-medical/services/fhir/fhirMapper.js";

const oid = () => new mongoose.Types.ObjectId();
const BASE = "https://example.test/fhir";

function ctx(clinicId) {
  return {
    userId: String(oid()),
    clinicId: String(clinicId),
    role: "owner",
    actorType: "user",
  };
}

function fakePatient(id = oid()) {
  // Поля PHI шифруются в модели; здесь важно, что экспорт их не роняет,
  // когда они пусты — расшифровка null должна давать null, а не бросать.
  return {
    _id: id,
    firstNameEncrypted: null,
    lastNameEncrypted: null,
    phoneEncrypted: null,
    emailEncrypted: null,
    gender: "female",
    dateOfBirth: new Date("1985-04-12"),
  };
}

describe("конвертер FHIR", () => {
  it("Observation несёт LOINC — ради него выгрузка и делается", () => {
    const panel = {
      _id: oid(),
      status: "final",
      effectiveDateTime: new Date("2026-08-01"),
    };
    const obs = map.toObservation(
      {
        name: "Гемоглобин",
        loincCode: "718-7",
        value: 98,
        unit: "г/л",
        referenceRange: { min: 120, max: 160 },
        flag: "low",
      },
      panel,
      "p1",
    );

    expect(obs.code.coding[0]).toMatchObject({
      system: "http://loinc.org",
      code: "718-7",
    });
    expect(obs.valueQuantity).toEqual({ value: 98, unit: "г/л" });
    expect(obs.referenceRange[0].low.value).toBe(120);
  });

  it("флаг «normal» НЕ переносится: это был бы вывод, которого лаборатория не делала", () => {
    const obs = map.toObservation(
      { name: "Лейкоциты", value: 6, unit: "10^9/л", flag: "normal" },
      { _id: oid(), status: "final" },
      "p1",
    );
    expect(obs.interpretation).toBeUndefined();
  });

  it("нечисловой результат не теряется, а уходит строкой", () => {
    const obs = map.toObservation(
      { name: "HBsAg", value: "отрицательно", flag: "normal" },
      { _id: oid(), status: "final" },
      "p1",
    );
    expect(obs.valueString).toBe("отрицательно");
    expect(obs.valueQuantity).toBeUndefined();
  });

  it("идентификатор Observation устойчив — повтор не создаст дубль", () => {
    const panel = { _id: oid(), status: "final" };
    const param = { name: "Гемоглобин", loincCode: "718-7", value: 98 };

    const a = map.toObservation(param, panel, "p1");
    const b = map.toObservation(param, panel, "p1");
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^[A-Za-z0-9.\-]+$/); // FHIR допускает только это
  });

  it("аллергия без кода вещества идёт текстом, а не выдуманным кодом", () => {
    const a = map.toAllergy(
      { _id: oid(), content: "Пенициллин — анафилаксия", createdAt: new Date() },
      "p1",
    );
    expect(a.code.text).toBe("Пенициллин — анафилаксия");
    // Выдуманный код опаснее его отсутствия: принимающая система будет
    // работать с ним как с достоверным.
    expect(a.code.coding).toBeUndefined();
    expect(a.clinicalStatus).toBeUndefined();
  });

  it("диагноз приёма несёт код МКБ-10", () => {
    const e = map.toEncounter(
      {
        _id: oid(),
        status: "signed",
        createdAt: new Date(),
        mainDiagnosis: { code: "I10", codeTitle: "Гипертензия", text: "ГБ II" },
      },
      "p1",
    );
    expect(e.reasonCode[0].coding[0]).toMatchObject({
      system: "http://hl7.org/fhir/sid/icd-10",
      code: "I10",
    });
  });

  it("пустые поля выбрасываются, а не отдаются как null", () => {
    const p = map.toPatient({ id: "p1" });
    expect(p).toEqual({
      resourceType: "Patient",
      id: "p1",
      identifier: [{ system: "urn:docpats:id", value: "p1" }],
    });
  });
});

describe("выгрузка карты", () => {
  it("собирает Bundle из тех же источников, что и списки", async () => {
    const clinicId = oid();
    const patient = fakePatient();
    const context = ctx(clinicId);

    await runWithTenantContext(context, () =>
      allergyService.create({ patient, body: { content: "Йод" } }),
    );

    await LabResult.create({
      patientRef: patient._id,
      patientTypeModel: "ClinicPatient",
      createdByClinicId: clinicId,
      createdBy: oid(),
      panelType: "BloodTestGeneral",
      status: "final",
      parameters: [
        {
          name: "Гемоглобин",
          loincCode: "718-7",
          valueType: "number",
          value: 98,
          unit: "г/л",
          flag: "low",
        },
      ],
    });

    const bundle = await runWithTenantContext(context, () =>
      exportPatientAsFhir({ patient, baseUrl: BASE }),
    );

    expect(bundle.resourceType).toBe("Bundle");
    expect(bundle.type).toBe("collection");

    const types = bundle.entry.map((e) => e.resource.resourceType);
    expect(types).toContain("Patient");
    expect(types).toContain("AllergyIntolerance");
    expect(types).toContain("Observation");

    // fullUrl строится от заданной базы, а не от заголовка Host: иначе
    // подставленный клиентом адрес уехал бы в чужую систему.
    expect(bundle.entry[0].fullUrl.startsWith(BASE)).toBe(true);
  });

  it("чужая клиника без согласия получает карту БЕЗ записей", async () => {
    const ownerClinic = oid();
    const foreignClinic = oid();
    const patient = fakePatient();

    await runWithTenantContext(ctx(ownerClinic), () =>
      allergyService.create({ patient, body: { content: "Пенициллин" } }),
    );

    const bundle = await runWithTenantContext(ctx(foreignClinic), () =>
      exportPatientAsFhir({ patient, baseUrl: BASE }),
    );

    const types = bundle.entry.map((e) => e.resource.resourceType);
    // Выгрузка кладёт ВСЮ карту в файл: утечка здесь стоит дороже, чем
    // в любом отдельном списке.
    expect(types).not.toContain("AllergyIntolerance");
    expect(types).toEqual(["Patient"]);
  });

  it("каждый показатель панели становится отдельным Observation", async () => {
    const clinicId = oid();
    const patient = fakePatient();

    await LabResult.create({
      patientRef: patient._id,
      patientTypeModel: "ClinicPatient",
      createdByClinicId: clinicId,
      createdBy: oid(),
      panelType: "BloodTestGeneral",
      status: "final",
      parameters: [
        { name: "Гемоглобин", valueType: "number", value: 98, flag: "low" },
        { name: "Лейкоциты", valueType: "number", value: 6, flag: "normal" },
        { name: "Тромбоциты", valueType: "number", value: 250, flag: "normal" },
      ],
    });

    const bundle = await runWithTenantContext(ctx(clinicId), () =>
      exportPatientAsFhir({ patient, baseUrl: BASE }),
    );

    const obs = bundle.entry.filter(
      (e) => e.resource.resourceType === "Observation",
    );
    // В FHIR единица — показатель, а не бланк.
    expect(obs).toHaveLength(3);
  });
});
