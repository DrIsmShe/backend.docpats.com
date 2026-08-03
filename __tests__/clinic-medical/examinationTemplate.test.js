// __tests__/clinic-medical/examinationTemplate.test.js
//
// Справочник заготовок для протоколов исследований.
//
// Что проверяется:
//   1.  создание — заготовка принадлежит клинике из контекста
//   2.  создание сотрудником клиники — автор пишется в другое поле
//   3.  создание с неизвестным видом исследования отклоняется
//   4.  создание с неизвестным видом заготовки отклоняется
//   5.  список фильтруется по виду исследования и виду заготовки
//   6.  ЧУЖАЯ клиника не видит заготовки в списке
//   7.  ЧУЖАЯ клиника не может прочитать заготовку по идентификатору
//   8.  ЧУЖАЯ клиника не может её править
//   9.  ЧУЖАЯ клиника не может её удалить
//   10. правка своей заготовки работает, вид исследования не меняется
//   11. удаление своей заготовки работает
//   12. медсестра читает справочник, но не правит
//
// Пункты 6–9 — обязательная для клинических тестов проверка межтенантной
// изоляции: запрос из контекста другой клиники обязан вести себя так, будто
// записи не существует.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import { runWithTenantContext } from "../../common/context/tenantContext.js";
import ExaminationTemplate from "../../modules/clinic/clinic-medical/models/examinationTemplate.model.js";
import * as svc from "../../modules/clinic/clinic-medical/services/examinationTemplate.service.js";

const oid = () => new mongoose.Types.ObjectId();

function ctx({ clinicId, userId = oid(), role = "doctor", actorType = "user" }) {
  return {
    userId: String(userId),
    clinicId: String(clinicId),
    role,
    actorType,
  };
}

/** Завести заготовку от имени клиники. */
function seed(clinicId, patch = {}) {
  return runWithTenantContext(ctx({ clinicId }), () =>
    svc.createTemplate({
      modality: "CT",
      kind: "report",
      title: "Норма",
      body: "Признаков очаговой патологии не выявлено.",
      ...patch,
    }),
  );
}

describe("создание заготовки", () => {
  let clinicA;
  beforeEach(() => {
    clinicA = oid();
  });

  it("заготовка принадлежит клинике из контекста, автор — врач", async () => {
    const userId = oid();
    const created = await runWithTenantContext(ctx({ clinicId: clinicA, userId }), () =>
      svc.createTemplate({
        modality: "MRI",
        kind: "diagnosis",
        title: "Без патологии",
        body: "Патологических изменений не выявлено.",
      }),
    );

    expect(created.modality).toBe("MRI");
    expect(created.kind).toBe("diagnosis");
    expect(created.createdBy).toBe(String(userId));
    expect(created.createdByEmployee).toBeNull();

    // clinicId проставил плагин, а не сервис вручную.
    const raw = await ExaminationTemplate.findById(created._id)
      .setOptions({ skipTenantScope: true })
      .lean();
    expect(String(raw.clinicId)).toBe(String(clinicA));
  });

  it("сотрудник клиники пишется в createdByEmployee, а не в createdBy", async () => {
    const employeeId = oid();
    const created = await runWithTenantContext(
      ctx({ clinicId: clinicA, userId: employeeId, actorType: "employee", role: "admin" }),
      () => svc.createTemplate({ modality: "CT", kind: "nameOfExam", title: "КТ ОГК" }),
    );

    expect(created.createdByEmployee).toBe(String(employeeId));
    expect(created.createdBy).toBeNull();
  });

  it("неизвестный вид исследования отклоняется", async () => {
    await expect(
      runWithTenantContext(ctx({ clinicId: clinicA }), () =>
        svc.createTemplate({ modality: "МРТ-по-русски", kind: "report", title: "x" }),
      ),
    ).rejects.toThrow(/modality/);
  });

  it("неизвестный вид заготовки отклоняется", async () => {
    await expect(
      runWithTenantContext(ctx({ clinicId: clinicA }), () =>
        svc.createTemplate({ modality: "CT", kind: "prognosis", title: "x" }),
      ),
    ).rejects.toThrow(/kind/);
  });

  it("пустой заголовок отклоняется", async () => {
    await expect(
      runWithTenantContext(ctx({ clinicId: clinicA }), () =>
        svc.createTemplate({ modality: "CT", kind: "report", title: "   " }),
      ),
    ).rejects.toThrow(/title/);
  });
});

describe("список заготовок", () => {
  let clinicA;
  beforeEach(async () => {
    clinicA = oid();
    await seed(clinicA, { modality: "CT", kind: "report", title: "КТ протокол" });
    await seed(clinicA, { modality: "CT", kind: "diagnosis", title: "КТ заключение" });
    await seed(clinicA, { modality: "MRI", kind: "report", title: "МРТ протокол" });
  });

  it("фильтрует по виду исследования", async () => {
    const { items } = await runWithTenantContext(ctx({ clinicId: clinicA }), () =>
      svc.listTemplates({ modality: "CT" }),
    );
    expect(items).toHaveLength(2);
    expect(items.every((t) => t.modality === "CT")).toBe(true);
  });

  it("фильтрует по виду исследования и виду заготовки вместе", async () => {
    const { items } = await runWithTenantContext(ctx({ clinicId: clinicA }), () =>
      svc.listTemplates({ modality: "CT", kind: "report" }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("КТ протокол");
  });
});

// ─── МЕЖТЕНАНТНАЯ ИЗОЛЯЦИЯ ─────────────────────────────────────────────
//
// Заготовка клиники A не должна существовать для клиники B ни в одной
// операции. Именно эти четыре теста ловят самый дорогой класс ошибок —
// утечку данных между клиниками.

describe("изоляция между клиниками", () => {
  let clinicA, clinicB, templateA;

  beforeEach(async () => {
    clinicA = oid();
    clinicB = oid();
    templateA = await seed(clinicA, { title: "Заготовка клиники A" });
  });

  it("чужая клиника не видит заготовку в списке", async () => {
    const { items } = await runWithTenantContext(ctx({ clinicId: clinicB }), () =>
      svc.listTemplates({ modality: "CT" }),
    );
    expect(items).toHaveLength(0);
  });

  it("чужая клиника не может прочитать заготовку по идентификатору", async () => {
    await expect(
      runWithTenantContext(ctx({ clinicId: clinicB }), () =>
        svc.getTemplate(templateA._id),
      ),
    ).rejects.toThrow(/ExaminationTemplate/);
  });

  it("чужая клиника не может править заготовку", async () => {
    await expect(
      runWithTenantContext(ctx({ clinicId: clinicB }), () =>
        svc.updateTemplate(templateA._id, { title: "Захвачено" }),
      ),
    ).rejects.toThrow(/ExaminationTemplate/);

    // Убеждаемся, что запись действительно не изменилась.
    const raw = await ExaminationTemplate.findById(templateA._id)
      .setOptions({ skipTenantScope: true })
      .lean();
    expect(raw.title).toBe("Заготовка клиники A");
  });

  it("чужая клиника не может удалить заготовку", async () => {
    // Роль admin взята намеренно: у неё право на удаление ЕСТЬ, и запрос
    // обязан упасть именно на изоляции, а не на нехватке прав. С ролью
    // doctor тест был бы бессмысленным — он проверял бы права, а не тенанта.
    await expect(
      runWithTenantContext(ctx({ clinicId: clinicB, role: "admin" }), () =>
        svc.deleteTemplate(templateA._id),
      ),
    ).rejects.toThrow(/ExaminationTemplate/);

    const raw = await ExaminationTemplate.findById(templateA._id)
      .setOptions({ skipTenantScope: true })
      .lean();
    expect(raw).not.toBeNull();
  });
});

describe("правка и удаление своей заготовки", () => {
  let clinicA, template;

  beforeEach(async () => {
    clinicA = oid();
    template = await seed(clinicA);
  });

  it("владелец правит заголовок и текст", async () => {
    const updated = await runWithTenantContext(ctx({ clinicId: clinicA }), () =>
      svc.updateTemplate(template._id, { title: "Норма (уточнено)", body: "Новый текст" }),
    );
    expect(updated.title).toBe("Норма (уточнено)");
    expect(updated.body).toBe("Новый текст");
  });

  it("вид исследования и вид заготовки правкой не меняются", async () => {
    const updated = await runWithTenantContext(ctx({ clinicId: clinicA }), () =>
      svc.updateTemplate(template._id, {
        title: "Ещё раз",
        modality: "MRI",
        kind: "diagnosis",
      }),
    );
    expect(updated.modality).toBe("CT");
    expect(updated.kind).toBe("report");
  });

  it("администратор клиники удаляет заготовку", async () => {
    // Удаление — право владельца и администратора; врач справочник только
    // пополняет и правит (см. тест ниже про роли).
    const res = await runWithTenantContext(ctx({ clinicId: clinicA, role: "admin" }), () =>
      svc.deleteTemplate(template._id),
    );
    expect(res.deleted).toBe(true);

    const raw = await ExaminationTemplate.findById(template._id)
      .setOptions({ skipTenantScope: true })
      .lean();
    expect(raw).toBeNull();
  });
});

// ─── ЗАГОТОВКИ ЗАПИСИ ПРИЁМА ───────────────────────────────────────────
//
// Тот же справочник обслуживает вторую область: блоки истории болезни —
// жалобы, анамнезы, статусы, рекомендации. Область (scope) обязана разделять
// их наглухо, иначе форма исследования начнёт предлагать жалобы, а форма
// приёма — протоколы КТ.

describe("заготовки записи приёма", () => {
  let clinicA;
  beforeEach(() => {
    clinicA = oid();
  });

  it("создаётся без вида исследования", async () => {
    const created = await runWithTenantContext(ctx({ clinicId: clinicA }), () =>
      svc.createTemplate({
        scope: "encounter",
        kind: "complaints",
        title: "Боли в эпигастрии",
        body: "Жалобы на боли в эпигастральной области натощак.",
      }),
    );

    expect(created.scope).toBe("encounter");
    expect(created.kind).toBe("complaints");
    expect(created.modality).toBeNull();
  });

  it("принимает все одиннадцать блоков приёма", async () => {
    const kinds = [
      "complaints", "anamnesisMorbi", "anamnesisVitae", "statusPreasens",
      "statusLocalis", "additionalDiagnosis", "recommendations",
      "ctScanResults", "mriResults", "ultrasoundResults", "laboratoryTestResults",
    ];

    for (const kind of kinds) {
      const created = await runWithTenantContext(ctx({ clinicId: clinicA }), () =>
        svc.createTemplate({ scope: "encounter", kind, title: `Заготовка ${kind}` }),
      );
      expect(created.kind).toBe(kind);
    }

    const { items } = await runWithTenantContext(ctx({ clinicId: clinicA }), () =>
      svc.listTemplates({ scope: "encounter" }),
    );
    expect(items).toHaveLength(kinds.length);
  });

  it("блок протокола исследования в области приёма отклоняется", async () => {
    await expect(
      runWithTenantContext(ctx({ clinicId: clinicA }), () =>
        svc.createTemplate({ scope: "encounter", kind: "nameOfExam", title: "x" }),
      ),
    ).rejects.toThrow(/kind/);
  });

  it("блок приёма в области исследования отклоняется", async () => {
    await expect(
      runWithTenantContext(ctx({ clinicId: clinicA }), () =>
        svc.createTemplate({ modality: "CT", kind: "complaints", title: "x" }),
      ),
    ).rejects.toThrow(/kind/);
  });

  it("области не видят заготовок друг друга", async () => {
    await seed(clinicA, { title: "Протокол КТ" });
    await runWithTenantContext(ctx({ clinicId: clinicA }), () =>
      svc.createTemplate({ scope: "encounter", kind: "complaints", title: "Жалобы" }),
    );

    const exams = await runWithTenantContext(ctx({ clinicId: clinicA }), () =>
      svc.listTemplates({ scope: "examination" }),
    );
    const visits = await runWithTenantContext(ctx({ clinicId: clinicA }), () =>
      svc.listTemplates({ scope: "encounter" }),
    );

    expect(exams.items.map((t) => t.title)).toEqual(["Протокол КТ"]);
    expect(visits.items.map((t) => t.title)).toEqual(["Жалобы"]);
  });

  it("заготовки приёма тоже не видны чужой клинике", async () => {
    const clinicB = oid();
    await runWithTenantContext(ctx({ clinicId: clinicA }), () =>
      svc.createTemplate({ scope: "encounter", kind: "anamnesisVitae", title: "Анамнез" }),
    );

    const { items } = await runWithTenantContext(ctx({ clinicId: clinicB }), () =>
      svc.listTemplates({ scope: "encounter" }),
    );
    expect(items).toHaveLength(0);
  });
});

describe("права ролей", () => {
  let clinicA, template;

  beforeEach(async () => {
    clinicA = oid();
    template = await seed(clinicA);
  });

  it("медсестра читает справочник", async () => {
    const found = await runWithTenantContext(ctx({ clinicId: clinicA, role: "nurse" }), () =>
      svc.getTemplate(template._id),
    );
    expect(found.title).toBe("Норма");
  });

  it("медсестра не может завести заготовку", async () => {
    await expect(
      runWithTenantContext(ctx({ clinicId: clinicA, role: "nurse" }), () =>
        svc.createTemplate({ modality: "CT", kind: "report", title: "Своя" }),
      ),
    ).rejects.toThrow();
  });

  it("врач не может удалить заготовку — это право владельца клиники", async () => {
    await expect(
      runWithTenantContext(ctx({ clinicId: clinicA, role: "doctor" }), () =>
        svc.deleteTemplate(template._id),
      ),
    ).rejects.toThrow();
  });
});
