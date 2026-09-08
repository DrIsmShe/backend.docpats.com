// Жалобы на ролики и комментарии.
//
// Проверяем то, ради чего эта подсистема существует, и то, чем она опасна:
//   • жалоба ничего не скрывает сама — материал остаётся видимым;
//   • повторная жалоба того же человека правит прежнюю, а не плодит записи;
//   • пожаловаться можно только на открытый материал;
//   • закрыть жалобу без объяснения нельзя.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";

import Video from "../../modules/video/models/video.model.js";
import ContentReport from "../../modules/video/models/contentReport.model.js";
import Comment from "../../common/models/Comments/CommentDocpats.js";
import {
  report,
  reportState,
  listReports,
  resolveReport,
} from "../../modules/video/services/contentReport.service.js";

const id = () => new mongoose.Types.ObjectId();

function человек(ownerId = id()) {
  return {
    ownerType: "user",
    ownerId,
    clinicId: null,
    role: null,
    permissions: null,
    email: null,
  };
}

function админ() {
  return { ownerType: "user", ownerId: id(), clinicId: null, role: "admin", email: null };
}

async function опубликованный(поля = {}) {
  return Video.create({
    ownerType: "user",
    ownerId: id(),
    title: "Разбор снимка",
    lang: "ru",
    kind: "explainer",
    visibility: "public",
    status: "ready",
    phi: false,
    publishedAt: new Date(),
    media: { storageKey: "videos/x.mp4", durationSec: 60, sizeBytes: 1000 },
    ...поля,
  });
}

describe("жалобы на материал", () => {
  it("жалоба принимается и не трогает сам ролик", async () => {
    const video = await опубликованный();

    const жалоба = await report({
      actor: человек(),
      data: { targetType: "video", targetId: String(video._id), reason: "medical" },
    });

    expect(жалоба.status).toBe("new");

    // ГЛАВНОЕ: материал остаётся на витрине. Автоснятие по сигналу —
    // готовый способ заглушить неудобный разбор.
    const свежий = await Video.findById(video._id).lean();
    expect(свежий.visibility).toBe("public");
    expect(свежий.archivedAt).toBeNull();
  });

  it("повторная жалоба того же человека правит прежнюю", async () => {
    const video = await опубликованный();
    const я = человек();

    await report({
      actor: я,
      data: { targetType: "video", targetId: String(video._id), reason: "spam" },
    });
    await report({
      actor: я,
      data: {
        targetType: "video",
        targetId: String(video._id),
        reason: "medical",
        note: "неверная дозировка",
      },
    });

    const все = await ContentReport.find({ targetId: video._id }).lean();
    expect(все).toHaveLength(1);
    expect(все[0].reason).toBe("medical");
    expect(все[0].note).toBe("неверная дозировка");
  });

  it("жалобы разных людей считаются отдельно", async () => {
    const video = await опубликованный();
    await report({
      actor: человек(),
      data: { targetType: "video", targetId: String(video._id), reason: "abuse" },
    });
    const я = человек();
    await report({
      actor: я,
      data: { targetType: "video", targetId: String(video._id), reason: "abuse" },
    });

    const состояние = await reportState({
      actor: я,
      targetType: "video",
      targetId: video._id,
    });
    expect(состояние.reports).toBe(2);
    expect(состояние.reportedByMe).toBe(true);
  });

  it("на приватный ролик пожаловаться нельзя", async () => {
    const video = await опубликованный({ visibility: "private", publishedAt: null });

    await expect(
      report({
        actor: человек(),
        data: { targetType: "video", targetId: String(video._id), reason: "spam" },
      }),
    ).rejects.toThrow(/не найден/i);
  });

  it("жалоба на комментарий под роликом привязывается к ролику", async () => {
    const video = await опубликованный();
    const комментарий = await Comment.create({
      content: "чушь",
      author: id(),
      targetId: video._id,
      targetType: "Video",
    });

    const жалоба = await report({
      actor: человек(),
      data: { targetType: "comment", targetId: String(комментарий._id), reason: "abuse" },
    });

    expect(String(жалоба.videoId)).toBe(String(video._id));
  });

  it("сотрудник клиники жалобу не подаёт — это делает человек", async () => {
    const video = await опубликованный();
    await expect(
      report({
        actor: { ownerType: "employee", ownerId: id(), clinicId: id(), role: "nurse" },
        data: { targetType: "video", targetId: String(video._id), reason: "spam" },
      }),
    ).rejects.toThrow();
  });
});

describe("разбор жалоб", () => {
  it("в очереди видно, на что жалуются", async () => {
    const video = await опубликованный({ title: "Как готовиться к КТ" });
    await report({
      actor: человек(),
      data: { targetType: "video", targetId: String(video._id), reason: "medical" },
    });

    const { items } = await listReports({ actor: админ(), query: {} });
    expect(items).toHaveLength(1);
    expect(items[0].video.title).toBe("Как готовиться к КТ");
  });

  it("закрыть жалобу без объяснения нельзя", async () => {
    const video = await опубликованный();
    const жалоба = await report({
      actor: человек(),
      data: { targetType: "video", targetId: String(video._id), reason: "spam" },
    });

    await expect(
      resolveReport({ actor: админ(), id: жалоба._id, status: "rejected" }),
    ).rejects.toThrow(/решение/i);
  });

  it("закрытая жалоба хранит решение и того, кто его принял", async () => {
    const video = await опубликованный();
    const жалоба = await report({
      actor: человек(),
      data: { targetType: "video", targetId: String(video._id), reason: "spam" },
    });

    const я = админ();
    const закрытая = await resolveReport({
      actor: я,
      id: жалоба._id,
      status: "rejected",
      resolution: "реклама не обнаружена",
    });

    expect(закрытая.status).toBe("rejected");
    expect(закрытая.resolution).toBe("реклама не обнаружена");
    expect(String(закрытая.handledBy)).toBe(String(я.ownerId));
    expect(закрытая.handledAt).toBeTruthy();
  });

  it("взятие в работу объяснения не требует", async () => {
    const video = await опубликованный();
    const жалоба = await report({
      actor: человек(),
      data: { targetType: "video", targetId: String(video._id), reason: "medical" },
    });

    const вРаботе = await resolveReport({
      actor: админ(),
      id: жалоба._id,
      status: "reviewing",
    });
    expect(вРаботе.status).toBe("reviewing");
    expect(вРаботе.handledAt).toBeNull();
  });
});
