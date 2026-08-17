// __tests__/audit/patientAccessLog.test.js
//
// «Кто открывал мою карту» — журнал доступа для пациента.
//
// Три вещи, ради которых написан файл:
//
//   1. Пациент видит ТОЛЬКО свой журнал. Чужой не достаётся никак.
//   2. Пациент НЕ видит имени сотрудника. Это не сокрытие: назвать
//      медсестру по имени недовольному человеку значит создать конфликт
//      между двумя людьми, ни один из которых не решает, кому положен
//      доступ. Отвечает организация — её и показываем.
//   3. Отказанные попытки показываются. «Вашу карту пытались открыть и
//      не смогли» — это ровно то, ради чего журнал заводят.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import HIPAAAuditLog from "../../modules/audit/models/AuditLog.model.js";
import Clinic from "../../modules/clinic/clinic-core/models/clinic.model.js";
import { getPatientAccessLog } from "../../modules/audit/services/patientAccessLog.service.js";

const oid = () => new mongoose.Types.ObjectId();

async function log(over = {}) {
  return HIPAAAuditLog.create({
    userId: over.userId || oid(),
    actorEmail: over.actorEmail || "nurse@clinic.example",
    actorRole: over.actorRole || "nurse",
    action: over.action || "clinic.medical.allergy.read",
    resourceType: over.resourceType || "clinic-medical-allergy",
    resourceOwnerId: over.resourceOwnerId,
    outcome: over.outcome || "success",
    clinicId: over.clinicId || null,
    ipAddress: "10.0.0.5",
    userAgent: "Mozilla/5.0",
  });
}

describe("журнал доступа для пациента", () => {
  let patientId;

  beforeEach(() => {
    patientId = oid();
  });

  it("показывает обращения к данным пациента", async () => {
    await log({ resourceOwnerId: patientId });

    const items = await getPatientAccessLog({ userId: patientId });
    expect(items).toHaveLength(1);
    expect(items[0].section).toBe("аллергии");
    expect(items[0].what).toBe("просмотр");
  });

  it("НЕ показывает имя и адрес сотрудника", async () => {
    await log({ resourceOwnerId: patientId });

    const [row] = await getPatientAccessLog({ userId: patientId });
    const asText = JSON.stringify(row);

    // Ни почты, ни IP, ни user-agent: это данные о сотруднике, а не о
    // пациенте, и в его журнале им не место.
    expect(asText).not.toMatch(/nurse@clinic/);
    expect(asText).not.toMatch(/10\.0\.0\.5/);
    expect(asText).not.toMatch(/Mozilla/);
    // Роль показываем: «врач» и «регистратура» — разные вещи для того,
    // кто читает свой журнал.
    expect(row.role).toBe("nurse");
  });

  it("называет организацию, а не человека", async () => {
    const clinic = await Clinic.create({
      name: "Клиника на Садовой",
      slug: `sad-${Date.now()}`,
      ownerId: oid(),
    });
    await log({ resourceOwnerId: patientId, clinicId: clinic._id });

    const [row] = await getPatientAccessLog({ userId: patientId });
    expect(row.organization).toBe("Клиника на Садовой");
  });

  it("чужой журнал не отдаётся", async () => {
    const someoneElse = oid();
    await log({ resourceOwnerId: someoneElse });

    const items = await getPatientAccessLog({ userId: patientId });
    expect(items).toEqual([]);
  });

  it("собственные действия пациента по умолчанию скрыты", async () => {
    // Увидев себя в списке «кто смотрел», человек решит, что за ним следят.
    await log({ resourceOwnerId: patientId, userId: patientId });

    const hidden = await getPatientAccessLog({ userId: patientId });
    expect(hidden).toEqual([]);

    const shown = await getPatientAccessLog({
      userId: patientId,
      includeOwn: true,
    });
    expect(shown).toHaveLength(1);
    expect(shown[0].isOwn).toBe(true);
  });

  it("отказанные попытки показываются и помечены", async () => {
    await log({ resourceOwnerId: patientId, outcome: "denied" });

    const [row] = await getPatientAccessLog({ userId: patientId });
    expect(row.denied).toBe(true);
  });

  it("выгрузка всей карты называется своими словами", async () => {
    await log({
      resourceOwnerId: patientId,
      resourceType: "clinic-medical-fhir-export",
      action: "clinic.medical.encounter.create",
    });

    const [row] = await getPatientAccessLog({ userId: patientId });
    // Человек должен понять, что унесли ВСЮ карту, а не открыли раздел.
    expect(row.section).toMatch(/выгрузка всей карты/);
  });

  it("незнакомый тип называется общими словами, а не пропускается", async () => {
    await log({
      resourceOwnerId: patientId,
      resourceType: "clinic-employee",
    });

    const [row] = await getPatientAccessLog({ userId: patientId });
    // Строка «кто-то обратился к вашим данным» честнее пропуска.
    expect(row.section).toBe("медицинские данные");
  });
});
