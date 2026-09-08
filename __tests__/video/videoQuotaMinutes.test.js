// Квота роликов: минуты рендера и объём хранения.
//
// Смысл фазы — перестать считать ролики штуками. Поэтому проверяем именно
// то, что штучный счёт скрывал: что двадцатисекундный и трёхминутный ролики
// расходуют разное, что окно скользящее, и что отказ приходит ДО рендера, а
// не после — иначе он уже оплачен, а результата всё равно нет.
//
// Файл видеозвонков рядом (videoQuota.service.test.js) считает минуты
// видеосвязи и к этому отношения не имеет: одинаковые слова, разные вещи.

import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

import Video from "../../modules/video/models/video.model.js";
import {
  videoUsage,
  videoQuota,
  canRender,
  videoCost,
  ЦЕНА_МИНУТЫ_РЕНДЕРА,
} from "../../modules/video/services/videoQuota.service.js";

const id = () => new mongoose.Types.ObjectId();

/** Ролик заданной длительности и веса, с датой создания. */
async function ролик({ ownerId, sec = 60, mb = 10, daysAgo = 0, status = "ready" }) {
  const doc = await Video.create({
    ownerType: "user",
    ownerId,
    title: "Ролик",
    status,
    media: {
      storageKey: `videos/${Math.random()}.mp4`,
      durationSec: sec,
      sizeBytes: mb * 1024 * 1024,
    },
  });
  if (daysAgo) {
    // Дату сдвигаем НАТИВНЫМ драйвером: mongoose со своими timestamps
    // переписывает createdAt обратно, и «старый» ролик оставался в окне —
    // тест на скользящее окно тогда ничего не проверял.
    await Video.collection.updateOne(
      { _id: doc._id },
      { $set: { createdAt: new Date(Date.now() - daysAgo * 86400000) } },
    );
  }
  return doc;
}

const пользователь = (plan, addon = 0) => ({
  _id: id(),
  subscriptionPlan: plan,
  videoRenderMinutesAddon: addon,
});

describe("расход", () => {
  it("минуты считаются по длительности, а не по числу роликов", async () => {
    const хозяин = id();
    await ролик({ ownerId: хозяин, sec: 20 });
    await ролик({ ownerId: хозяин, sec: 20 });
    await ролик({ ownerId: хозяин, sec: 200 });

    const { renderedMinutes, videos } = await videoUsage({
      ownerType: "user",
      ownerId: хозяин,
    });

    // Три ролика, но 4 минуты: штучный счёт этой разницы не видел.
    expect(videos).toBe(3);
    expect(renderedMinutes).toBe(4);
  });

  it("окно скользящее: ролик месячной давности минут не занимает", async () => {
    const хозяин = id();
    await ролик({ ownerId: хозяин, sec: 600, daysAgo: 40 });
    await ролик({ ownerId: хозяин, sec: 60 });

    const { renderedMinutes, storageGb } = await videoUsage({
      ownerType: "user",
      ownerId: хозяин,
    });

    expect(renderedMinutes).toBe(1);
    // А вот хранение накопительное: старый ролик всё ещё лежит и стоит денег.
    expect(storageGb).toBeGreaterThan(0);
  });

  it("черновики без файла расхода не создают", async () => {
    const хозяин = id();
    await ролик({ ownerId: хозяин, sec: 120, status: "draft" });
    const { renderedMinutes } = await videoUsage({ ownerType: "user", ownerId: хозяин });
    expect(renderedMinutes).toBe(0);
  });

  it("чужие ролики в расход не попадают", async () => {
    const хозяин = id();
    await ролик({ ownerId: id(), sec: 600 });
    const { renderedMinutes } = await videoUsage({ ownerType: "user", ownerId: хозяин });
    expect(renderedMinutes).toBe(0);
  });
});

describe("предел тарифа", () => {
  it("на бесплатном плане предел есть и виден остаток", async () => {
    const user = пользователь("doctor_free");
    await ролик({ ownerId: user._id, sec: 120 });

    const квота = await videoQuota({ user, ownerId: user._id });
    expect(квота.renderLimit).toBe(6);
    expect(квота.renderedMinutes).toBe(2);
    expect(квота.renderLeft).toBe(4);
  });

  it("на платном плане предела нет", async () => {
    const user = пользователь("doctor_pro");
    await ролик({ ownerId: user._id, sec: 3600 });

    const квота = await videoQuota({ user, ownerId: user._id });
    expect(квота.renderLimit).toBe(-1);
    expect(квота.renderLeft).toBe(-1);
  });

  it("докупленные минуты складываются с тарифом", async () => {
    // Человек, выбравший пакет, не должен ждать следующего месяца.
    const user = пользователь("doctor_free", 30);
    const квота = await videoQuota({ user, ownerId: user._id });
    expect(квота.renderLimit).toBe(36);
  });
});

describe("отказ до рендера", () => {
  it("ролик, не влезающий в остаток, не пропускается", async () => {
    const user = пользователь("doctor_free"); // 6 минут
    await ролик({ ownerId: user._id, sec: 300 }); // израсходовано 5

    const { allowed, reason } = await canRender({
      user,
      ownerId: user._id,
      durationSec: 180, // нужно ещё 3
    });

    expect(allowed).toBe(false);
    expect(reason).toMatch(/не хватает минут/i);
  });

  it("влезающий ролик пропускается", async () => {
    const user = пользователь("doctor_free");
    await ролик({ ownerId: user._id, sec: 60 });

    const { allowed } = await canRender({ user, ownerId: user._id, durationSec: 120 });
    expect(allowed).toBe(true);
  });

  it("без предела разрешено всё", async () => {
    const user = пользователь("doctor_pro");
    const { allowed } = await canRender({ user, ownerId: user._id, durationSec: 10000 });
    expect(allowed).toBe(true);
  });
});

describe("себестоимость", () => {
  it("считается по тем же ставкам, что и тарифная модель", async () => {
    const хозяин = id();
    await ролик({ ownerId: хозяин, sec: 600, mb: 100 });

    const отчёт = await videoCost({ ownerType: "user", ownerId: хозяин });

    expect(отчёт.renderedMinutes).toBe(10);
    expect(отчёт.renderCost).toBeCloseTo(10 * ЦЕНА_МИНУТЫ_РЕНДЕРА, 2);
    // Хранение считается отдельно: оно ежемесячное и накопительное, а
    // рендер — разовый расход в момент создания.
    expect(отчёт.storageCost).toBeGreaterThanOrEqual(0);
    expect(отчёт.totalCost).toBeCloseTo(отчёт.renderCost + отчёт.storageCost, 2);
  });

  it("пустой каталог — нулевая себестоимость, а не ошибка", async () => {
    const отчёт = await videoCost({ ownerType: "user", ownerId: id() });
    expect(отчёт).toMatchObject({ renderedMinutes: 0, videos: 0, totalCost: 0 });
  });
});
