// Статистика автора по своему ролику.
//
// Автор видел одно число — просмотры, по которому нельзя понять главного:
// досматривают ли объяснение. Проверяем, что считается именно это, и что
// чужую статистику посмотреть нельзя: это работа автора над своим
// материалом, а не общий отчёт по клинике.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";

import Video from "../../modules/video/models/video.model.js";
import HIPAAAuditLog from "../../modules/audit/models/AuditLog.model.js";
import {
  statsForVideo,
  statsForOwner,
} from "../../modules/video/services/videoStats.service.js";

const id = () => new mongoose.Types.ObjectId();

function автор(ownerId = id()) {
  return { ownerType: "user", ownerId, clinicId: null, role: null, email: null };
}

async function ролик(ownerId, поля = {}) {
  return Video.create({
    ownerType: "user",
    ownerId,
    title: "Подготовка к МРТ",
    lang: "ru",
    kind: "explainer",
    visibility: "public",
    status: "ready",
    publishedAt: new Date(),
    media: { storageKey: "videos/x.mp4", durationSec: 100, sizeBytes: 100 },
    ...поля,
  });
}

/** Событие просмотра — то самое, на котором держится и видео-согласие. */
async function просмотр(videoId, userId, { ratio, completed }) {
  return HIPAAAuditLog.create({
    userId,
    action: "video.watch",
    resourceType: "video",
    resourceId: videoId,
    outcome: "success",
    metadata: { ratio, completed, durationSec: 100 },
  });
}

describe("статистика ролика", () => {
  it("считает долю досмотров и среднюю глубину", async () => {
    const я = автор();
    const в = await ролик(я.ownerId);

    await просмотр(в._id, id(), { ratio: 1, completed: true });
    await просмотр(в._id, id(), { ratio: 0.5, completed: false });
    await просмотр(в._id, id(), { ratio: 0.5, completed: false });
    await просмотр(в._id, id(), { ratio: 1, completed: true });

    const с = await statsForVideo({ actor: я, id: в._id });

    expect(с.watches).toBe(4);
    expect(с.completions).toBe(2);
    expect(с.completionRate).toBe(50);
    expect(с.averageDepth).toBe(75);
  });

  it("показывает, докуда досматривают", async () => {
    const я = автор();
    const в = await ролик(я.ownerId);

    // Двое бросили в первой пятой, один досмотрел до конца.
    await просмотр(в._id, id(), { ratio: 0.1, completed: false });
    await просмотр(в._id, id(), { ratio: 0.15, completed: false });
    await просмотр(в._id, id(), { ratio: 1, completed: true });

    const с = await statsForVideo({ actor: я, id: в._id });

    expect(с.dropoff[0]).toBe(2);
    expect(с.dropoff[4]).toBe(1);
  });

  it("чужую статистику не отдаёт", async () => {
    const в = await ролик(id());
    await expect(statsForVideo({ actor: автор(), id: в._id })).rejects.toThrow();
  });

  it("без просмотров отвечает нулями, а не ошибкой", async () => {
    const я = автор();
    const в = await ролик(я.ownerId);

    const с = await statsForVideo({ actor: я, id: в._id });
    expect(с.watches).toBe(0);
    expect(с.completionRate).toBe(0);
    expect(с.dropoff).toEqual([0, 0, 0, 0, 0]);
  });

  it("старые события за пределами окна не учитываются", async () => {
    const я = автор();
    const в = await ролик(я.ownerId);

    const старое = await просмотр(в._id, id(), { ratio: 1, completed: true });
    // Сдвигаем в прошлое мимо схемы: createdAt проставляется временем.
    await HIPAAAuditLog.collection.updateOne(
      { _id: старое._id },
      { $set: { createdAt: new Date(Date.now() - 90 * 86400000) } },
    );

    const с = await statsForVideo({ actor: я, id: в._id, days: 30 });
    expect(с.watches).toBe(0);
  });

  it("сводка по всем роликам считает каждый отдельно", async () => {
    const я = автор();
    const первый = await ролик(я.ownerId, { title: "Первый" });
    const второй = await ролик(я.ownerId, { title: "Второй" });

    await просмотр(первый._id, id(), { ratio: 1, completed: true });
    await просмотр(второй._id, id(), { ratio: 0.2, completed: false });
    await просмотр(второй._id, id(), { ratio: 0.2, completed: false });

    const { items } = await statsForOwner({ actor: я });

    const п = items.find((и) => и.title === "Первый");
    const в = items.find((и) => и.title === "Второй");

    expect(п.completionRate).toBe(100);
    expect(в.watches).toBe(2);
    expect(в.completionRate).toBe(0);
  });

  it("в сводку не попадают чужие ролики", async () => {
    const я = автор();
    await ролик(я.ownerId, { title: "Мой" });
    await ролик(id(), { title: "Чужой" });

    const { items } = await statsForOwner({ actor: я });
    expect(items.map((и) => и.title)).toEqual(["Мой"]);
  });
});
