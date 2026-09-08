// Машинная сборка ролика: сценарий, врачебная проверка, очередь рендера.
//
// Проверяем главное правило фазы: сгенерированный ролик не выходит за
// пределы черновика, пока сценарий не подтвердил человек. Текстовую
// неточность в статье правят незаметно; ролик, который пациент посмотрел
// перед вмешательством и под который подписал согласие, отозвать нельзя.
//
// Модель не зовём: её ответ подменяем на предсказуемый сценарий. Проверять
// тут нужно наши решения — что мы делаем с результатом, а не то, как он
// сочинён.

import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

const сценарий = {
  title: "Что показал ваш снимок",
  kind: "radiology_review",
  lang: "ru",
  scenes: [
    { narration: "Первая находка", caption: "", seconds: 10, visual: "" },
    { narration: "Вторая находка", caption: "", seconds: 12, visual: "" },
  ],
  durationSec: 22,
  usage: { inputTokens: 100, outputTokens: 200 },
};

vi.mock("../../modules/video/render/scriptwriter.js", () => ({
  scriptFromSummary: vi.fn(async () => ({ ...сценарий, kind: "consult_summary" })),
  scriptFromRadiologyCase: vi.fn(async () => сценарий),
}));

vi.mock("../../modules/video/render/render.queue.js", () => ({
  enqueueRender: vi.fn(async () => ({ id: "job-1" })),
  renderEnabled: vi.fn(() => true),
}));

import { enqueueRender, renderEnabled } from "../../modules/video/render/render.queue.js";
import { scriptFromRadiologyCase } from "../../modules/video/render/scriptwriter.js";
import Video from "../../modules/video/models/video.model.js";
import HIPAAAuditLog from "../../modules/audit/models/AuditLog.model.js";
import {
  draftFromData,
  approveGenerated,
  rejectGenerated,
} from "../../modules/video/services/videoGeneration.service.js";

const id = () => new mongoose.Types.ObjectId();
const клиника = id();

const врач = (ownerId = id()) => ({
  ownerType: "user",
  ownerId,
  clinicId: клиника,
  role: "doctor",
  permissions: null,
  membershipId: id(),
  email: null,
});

async function черновик(actor = врач()) {
  return draftFromData({
    actor,
    data: { source: "summary", summary: "Врачебный текст про находку", lang: "ru" },
  });
}

beforeEach(() => {
  enqueueRender.mockClear();
  renderEnabled.mockReturnValue(true);
});

describe("черновик из данных", () => {
  it("сохраняет сценарий и ждёт врача", async () => {
    const video = await черновик();

    expect(video.status).toBe("draft");
    expect(video.visibility).toBe("private");
    expect(video.source.kind).toBe("generated");
    expect(video.review.status).toBe("pending");
    expect(video.generation.script.scenes).toHaveLength(2);
    // Длительность берётся из сценария: без неё нельзя ни посчитать досмотр,
    // ни потребовать согласия.
    expect(video.media.durationSec).toBe(22);
  });

  it("сборка из радиологии тянет случай и передаёт его сценаристу", async () => {
    const RadiologyCase = (
      await import("../../modules/radiology/radiology-cases/models/radiologyCase.model.js")
    ).default;
    const caseDoc = await RadiologyCase.create({
      title: "Пневмония",
      modality: "cxr",
      // source обязателен в модели случая: у снимка всегда есть
      // происхождение, и без него кейс не сохранить.
      source: { kind: "original" },
      images: [{ url: "https://example.test/1.png", order: 0 }],
      findings: [
        {
          key: "f1",
          imageIndex: 0,
          label: "Инфильтрат",
          geometry: { shape: "point", coords: { x: 0.5, y: 0.5 } },
          explanation: "Затемнение в нижней доле",
        },
      ],
    });

    const video = await draftFromData({
      actor: врач(),
      data: { source: "radiology", caseId: caseDoc._id },
    });

    expect(scriptFromRadiologyCase).toHaveBeenCalled();
    expect(video.kind).toBe("radiology_review");
    expect(String(video.source.ref.entityId)).toBe(String(caseDoc._id));
  });

  it("несуществующий случай радиологии — отказ", async () => {
    await expect(
      draftFromData({ actor: врач(), data: { source: "radiology", caseId: id() } }),
    ).rejects.toThrow(/не найден/i);
  });

  it("неизвестный источник отклоняется", async () => {
    await expect(
      draftFromData({ actor: врач(), data: { source: "воздух" } }),
    ).rejects.toThrow(/источник/i);
  });
});

describe("врачебная проверка", () => {
  it("неподтверждённый ролик нельзя открыть даже владельцу", async () => {
    // Последняя линия: правило стоит в модели, поэтому не обходится ни
    // воркером, ни ручной правкой мимо сервиса.
    const video = await черновик();
    video.status = "ready";
    video.visibility = "link";

    await expect(video.save()).rejects.toThrow(/подтвердил врач/i);
  });

  it("подтверждение ставит задание на рендер", async () => {
    const автор = врач();
    const video = await черновик(автор);

    const { queued } = await approveGenerated({
      actor: автор,
      id: video._id,
      notes: "всё верно",
    });

    expect(queued).toBe(true);
    expect(enqueueRender).toHaveBeenCalledTimes(1);
    const задание = enqueueRender.mock.calls[0][0];
    expect(String(задание.videoId)).toBe(String(video._id));
    expect(задание.script.scenes).toHaveLength(2);

    const свежий = await Video.findById(video._id);
    expect(свежий.review.status).toBe("approved");
    expect(String(свежий.review.byUserId)).toBe(String(автор.ownerId));
  });

  it("при выключенной генерации подтверждение состоится, но задания не будет", async () => {
    renderEnabled.mockReturnValue(false);
    const автор = врач();
    const video = await черновик(автор);

    const { queued } = await approveGenerated({ actor: автор, id: video._id });

    expect(queued).toBe(false);
    expect(enqueueRender).not.toHaveBeenCalled();
    expect((await Video.findById(video._id)).review.status).toBe("approved");
  });

  it("после подтверждения ролик можно открыть", async () => {
    const автор = врач();
    const video = await черновик(автор);
    await approveGenerated({ actor: автор, id: video._id });

    const свежий = await Video.findById(video._id);
    свежий.status = "ready";
    свежий.visibility = "link";
    await expect(свежий.save()).resolves.toBeTruthy();
  });

  it("дважды подтвердить нельзя", async () => {
    const автор = врач();
    const video = await черновик(автор);
    await approveGenerated({ actor: автор, id: video._id });

    await expect(
      approveGenerated({ actor: автор, id: video._id }),
    ).rejects.toThrow(/уже подтверждён/i);
  });

  it("отказ требует причины — по ней сценарий перепишут", async () => {
    const автор = врач();
    const video = await черновик(автор);

    await expect(
      rejectGenerated({ actor: автор, id: video._id, notes: "  " }),
    ).rejects.toThrow(/что не так/i);

    const отклонён = await rejectGenerated({
      actor: автор,
      id: video._id,
      notes: "во второй сцене неверная сторона",
    });
    expect(отклонён.review.status).toBe("rejected");
  });

  it("чужой ролик не подтвердить", async () => {
    const video = await черновик(врач());
    const чужой = { ...врач(), clinicId: id() };

    await expect(
      approveGenerated({ actor: чужой, id: video._id }),
    ).rejects.toThrow(/не найден/i);
  });

  it("коллега по клинике с правом записи подтвердить может", async () => {
    // Ролик, собранный уходящей сменой, не должен зависать до её возвращения.
    const автор = врач();
    const коллега = врач();
    const video = await черновик(автор);

    const { video: подтверждён } = await approveGenerated({
      actor: коллега,
      id: video._id,
    });
    expect(String(подтверждён.review.byUserId)).toBe(String(коллега.ownerId));
  });
});

describe("журнал генерации", () => {
  it("создание и подтверждение записаны, расход модели виден", async () => {
    const автор = врач();
    const video = await черновик(автор);
    await approveGenerated({ actor: автор, id: video._id, notes: "ок" });

    const записи = await HIPAAAuditLog.find({ resourceType: "video" }).lean();
    const действия = записи.map((з) => з.action);
    expect(действия).toContain("video.create");
    expect(действия).toContain("video.review.approve");

    const создание = записи.find((з) => з.action === "video.create");
    expect(создание.metadata.sourceKind).toBe("generated");
    // Токены — единственный способ узнать себестоимость ролика постфактум.
    expect(создание.metadata.outputTokens).toBe(200);
  });

  it("текст сценария в журнал не попадает", async () => {
    const автор = врач();
    const video = await черновик(автор);
    await approveGenerated({ actor: автор, id: video._id });

    const записи = await HIPAAAuditLog.find({ resourceType: "video" }).lean();
    const всё = JSON.stringify(записи.map((з) => з.metadata));
    expect(всё).not.toMatch(/находка/i);
  });
});
