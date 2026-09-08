// Счётчик просмотров витрины.
//
// Счётчик показывался на каждой карточке и всегда стоял на нуле: отчёт о
// просмотре умел отправлять только кабинет, а его маршрут за сессией —
// гость, ради которого витрина и открыта, не мог засчитать ничего.
// Проверяем ровно это: считается ли просмотр без входа и не считается ли
// то, чего показывать нельзя.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";

import Video from "../../modules/video/models/video.model.js";
import { countPublicView } from "../../modules/video/services/video.service.js";

const id = () => new mongoose.Types.ObjectId();

async function ролик(поля = {}) {
  return Video.create({
    ownerType: "user",
    ownerId: id(),
    title: "Как готовиться к МРТ",
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

describe("просмотры витрины", () => {
  it("гость увеличивает счётчик", async () => {
    const в = await ролик();

    const первый = await countPublicView({ id: в._id, viewerId: null });
    expect(первый.views).toBe(1);

    const второй = await countPublicView({ id: в._id, viewerId: null });
    expect(второй.views).toBe(2);

    const свежий = await Video.findById(в._id).lean();
    expect(свежий.stats.views).toBe(2);
  });

  it("приватный ролик не считается", async () => {
    const в = await ролик({ visibility: "private", publishedAt: null });

    const итог = await countPublicView({ id: в._id, viewerId: null });
    expect(итог.views).toBe(0);

    const свежий = await Video.findById(в._id).lean();
    expect(свежий.stats.views).toBe(0);
  });

  it("ролик с пациентом в кадре не считается", async () => {
    // phi-ролик не бывает публичным, но проверка стоит в запросе отдельно:
    // счётчик не должен зависеть от того, что где-то ещё не нарушено.
    const в = await ролик({ phi: true, visibility: "private", publishedAt: null });
    const итог = await countPublicView({ id: в._id, viewerId: null });
    expect(итог.views).toBe(0);
  });

  it("архивный ролик не считается", async () => {
    const в = await ролик({ archivedAt: new Date(), archiveReason: "жалоба" });
    const итог = await countPublicView({ id: в._id, viewerId: null });
    expect(итог.views).toBe(0);
  });

  it("несуществующий идентификатор не роняет запрос", async () => {
    expect((await countPublicView({ id: "мусор" })).views).toBe(0);
    expect((await countPublicView({ id: String(id()) })).views).toBe(0);
  });

  it("просмотр вошедшего оставляет след для подборок", async () => {
    const в = await ролик();
    const зритель = id();

    await countPublicView({ id: в._id, viewerId: зритель });

    const { default: VideoInterest } = await import(
      "../../modules/video/models/videoInterest.model.js"
    );
    const след = await VideoInterest.findOne({ viewerId: зритель }).lean();
    expect(след).toBeTruthy();
    expect(String(след.videoId)).toBe(String(в._id));
  });

  it("у гостя следа не остаётся", async () => {
    const в = await ролик();
    await countPublicView({ id: в._id, viewerId: null });

    const { default: VideoInterest } = await import(
      "../../modules/video/models/videoInterest.model.js"
    );
    expect(await VideoInterest.countDocuments({})).toBe(0);
  });
});
