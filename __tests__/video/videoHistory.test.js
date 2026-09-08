// История просмотров на витрине.
//
// Строится на том же следе, что и подборка, и с тем же ограничением:
// только открытые ролики без PHI. Показ объяснения перед вмешательством в
// историю не попадает — её могут читать через плечо, а список
// просмотренного говорит о человеке слишком много.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";

import Video from "../../modules/video/models/video.model.js";
import VideoInterest from "../../modules/video/models/videoInterest.model.js";
import { история } from "../../modules/video/services/videoFeed.service.js";

const id = () => new mongoose.Types.ObjectId();

function зритель(ownerId = id()) {
  return { ownerType: "user", ownerId };
}

async function ролик(поля = {}) {
  return Video.create({
    ownerType: "user",
    ownerId: id(),
    title: "Ролик",
    lang: "ru",
    kind: "explainer",
    visibility: "public",
    status: "ready",
    phi: false,
    publishedAt: new Date(),
    media: { storageKey: "videos/x.mp4", durationSec: 60, sizeBytes: 100 },
    ...поля,
  });
}

async function посмотрел(viewerId, video, когда) {
  return VideoInterest.create({
    viewerId,
    videoId: video._id,
    categoryId: video.categoryId || null,
    kind: video.kind,
    lang: video.lang,
    channelType: "user",
    channelId: video.ownerId,
    ratio: 0.8,
    watchedAt: когда,
  });
}

describe("история просмотров", () => {
  it("гостю пуста", async () => {
    expect(await история({ viewer: null })).toEqual([]);
  });

  it("без просмотров пуста", async () => {
    expect(await история({ viewer: зритель() })).toEqual([]);
  });

  it("порядок — по времени просмотра, а не публикации", async () => {
    // Человек ищет то, что смотрел вчера, а не самый свежий ролик.
    const я = зритель();
    const старый = await ролик({
      title: "Смотрел позже",
      publishedAt: new Date("2020-01-01"),
    });
    const свежий = await ролик({ title: "Смотрел раньше" });

    await посмотрел(я.ownerId, свежий, new Date(Date.now() - 3600e3));
    await посмотрел(я.ownerId, старый, new Date());

    const список = await история({ viewer: я });
    expect(список.map((в) => в.title)).toEqual(["Смотрел позже", "Смотрел раньше"]);
  });

  it("чужие просмотры не показывает", async () => {
    const в = await ролик();
    await посмотрел(id(), в, new Date());

    expect(await история({ viewer: зритель() })).toEqual([]);
  });

  it("снятый с витрины ролик исчезает из истории", async () => {
    // След остаётся, но показывать закрытое нельзя: доступ решает
    // видимость ролика, а не то, что человек его когда-то видел.
    const я = зритель();
    const в = await ролик();
    await посмотрел(я.ownerId, в, new Date());

    await Video.updateOne({ _id: в._id }, { $set: { visibility: "private" } });
    expect(await история({ viewer: я })).toEqual([]);
  });

  it("архивный ролик в историю не попадает", async () => {
    const я = зритель();
    const в = await ролик();
    await посмотрел(я.ownerId, в, new Date());

    await Video.updateOne({ _id: в._id }, { $set: { archivedAt: new Date() } });
    expect(await история({ viewer: я })).toEqual([]);
  });
});
