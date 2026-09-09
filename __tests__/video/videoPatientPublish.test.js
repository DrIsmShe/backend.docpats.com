// Публикация ролика пациентом.
//
// Пациент может рассказать свою историю, но она ложится на свою полку и в
// счётном количестве: открытый каталог просматривает человек, и «Разборы
// снимков» от пациента — это не разбор снимка.
//
// Отдельно проверяем то, что легко сломать при следующей правке: счёт
// идёт по ОПУБЛИКОВАННЫМ, а не по загруженным, и повторная публикация
// того же ролика не упирается в предел, который он сам и занимает.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";

import Video from "../../modules/video/models/video.model.js";
import VideoCategory from "../../modules/video/models/videoCategory.model.js";
import {
  ПОЛКА_ПАЦИЕНТОВ,
  полкаПациентов,
  этоПациент,
  проверитьЛимитПубликаций,
  подготовитьПубликациюПациента,
} from "../../modules/video/services/videoPatientPublish.service.js";

const id = () => new mongoose.Types.ObjectId();

function пациент(план = "patient_free") {
  return { role: "patient", subscriptionPlan: план };
}

async function ролик(ownerId, поля = {}) {
  return Video.create({
    ownerType: "user",
    ownerId,
    title: "Моя история",
    lang: "ru",
    kind: "explainer",
    status: "ready",
    media: { storageKey: "videos/x.mp4", durationSec: 60, sizeBytes: 100 },
    ...поля,
  });
}

describe("кто такой пациент", () => {
  it("роль patient — да", () => {
    expect(этоПациент({ role: "patient" })).toBe(true);
  });

  it("врач и сотрудник клиники — нет", () => {
    expect(этоПациент({ role: "doctor" })).toBe(false);
    expect(этоПациент({ role: "clinic_staff" })).toBe(false);
    expect(этоПациент(null)).toBe(false);
  });
});

describe("полка пациентов", () => {
  it("создаётся сама при первой надобности", async () => {
    // Правило «пациент публикует сюда» бессмысленно, если «сюда» может
    // не существовать.
    const полка = await полкаПациентов();
    expect(полка.slug).toBe(ПОЛКА_ПАЦИЕНТОВ);
    expect(полка.title.ru).toBe("Мнения пациентов");
  });

  it("второй раз не плодится", async () => {
    await полкаПациентов();
    await полкаПациентов();
    expect(await VideoCategory.countDocuments({ slug: ПОЛКА_ПАЦИЕНТОВ })).toBe(1);
  });

  it("названа на всех пяти языках", async () => {
    const полка = await полкаПациентов();
    for (const язык of ["ru", "en", "az", "tr", "ar"]) {
      expect(полка.title[язык], `нет названия на ${язык}`).toBeTruthy();
    }
  });

  it("публикация пациента переносится на неё независимо от выбора", async () => {
    // Даже если пациент выбрал «Разборы снимков» — читатель ждёт от этой
    // полки разбор врача, и подменять ожидание нельзя.
    const в = await ролик(id(), { categoryId: id(), kind: "radiology_review" });
    const правки = await подготовитьПубликациюПациента(в);

    const полка = await полкаПациентов();
    expect(String(правки.categoryId)).toBe(String(полка._id));
    expect(правки.kind).toBe("other");
  });
});

describe("счёт публикаций", () => {
  it("на бесплатном тарифе — одна", async () => {
    const ownerId = id();
    const итог = await проверитьЛимитПубликаций({ user: пациент(), ownerId });
    expect(итог.limit).toBe(1);
    expect(итог.left).toBe(1);
  });

  it("вторую публикацию не пускает", async () => {
    const ownerId = id();
    await ролик(ownerId, { visibility: "public", publishedAt: new Date() });

    await expect(
      проверитьЛимитПубликаций({ user: пациент(), ownerId }),
    ).rejects.toThrow(/1/);
  });

  it("черновики не считаются", async () => {
    // Ограничен выход в каталог, а не съёмка: хранить и показывать
    // своему врачу можно в пределах места на тарифе.
    const ownerId = id();
    await ролик(ownerId, { visibility: "private" });
    // Видимость "clinic" требует клиники — иначе ролик не увидит никто,
    // и модель справедливо отказывает в сохранении.
    await ролик(ownerId, { visibility: "clinic", clinicId: id() });

    const итог = await проверитьЛимитПубликаций({ user: пациент(), ownerId });
    expect(итог.used).toBe(0);
  });

  it("снятый с витрины освобождает место", async () => {
    const ownerId = id();
    const в = await ролик(ownerId, { visibility: "public", publishedAt: new Date() });

    await expect(
      проверитьЛимитПубликаций({ user: пациент(), ownerId }),
    ).rejects.toThrow();

    await Video.updateOne({ _id: в._id }, { $set: { visibility: "private" } });
    const итог = await проверитьЛимитПубликаций({ user: пациент(), ownerId });
    expect(итог.left).toBe(1);
  });

  it("повторная публикация того же ролика проходит", async () => {
    // Он уже занимает место — упираться в предел, который он же и
    // создал, человек не должен.
    const ownerId = id();
    const в = await ролик(ownerId, { visibility: "public", publishedAt: new Date() });

    const итог = await проверитьЛимитПубликаций({
      user: пациент(),
      ownerId,
      exceptId: в._id,
    });
    expect(итог.used).toBe(0);
  });

  it("платный тариф пациента даёт пять", async () => {
    const итог = await проверитьЛимитПубликаций({
      user: пациент("patient_std"),
      ownerId: id(),
    });
    expect(итог.limit).toBe(5);
  });

  it("врача счёт не ограничивает", async () => {
    const ownerId = id();
    for (let i = 0; i < 8; i += 1) {
      await ролик(ownerId, { visibility: "public", publishedAt: new Date() });
    }

    const итог = await проверитьЛимитПубликаций({
      user: { role: "doctor", subscriptionPlan: "doctor_pro" },
      ownerId,
    });
    expect(итог.limit).toBe(-1);
    expect(итог.left).toBe(-1);
  });

  it("архивный ролик места не занимает", async () => {
    const ownerId = id();
    await ролик(ownerId, {
      visibility: "public",
      publishedAt: new Date(),
      archivedAt: new Date(),
      archiveReason: "жалоба",
    });

    const итог = await проверитьЛимитПубликаций({ user: пациент(), ownerId });
    expect(итог.used).toBe(0);
  });
});
