// «Мои ролики» — только мои.
//
// Список подмешивал ролики клиники всякому, у кого есть право video:read.
// Пациент, оказавшийся администратором клиники своего врача, видел под
// заголовком «Мои ролики» чужие фильмы — и кнопку «Удалить» на них.
// Приватные не утекали, но список называл чужое своим.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";

import Video from "../../modules/video/models/video.model.js";
import { listVideos } from "../../modules/video/services/video.service.js";

const id = () => new mongoose.Types.ObjectId();

/** Человек с ролью в клинике: администратор, врач, кто угодно с video:read. */
function участник(clinicId, role, ownerId = id()) {
  return {
    ownerType: "user",
    ownerId,
    clinicId,
    role,
    permissions: null,
    membershipId: id(),
    email: null,
  };
}

async function ролик(поля) {
  return Video.create({
    ownerType: "user",
    ownerId: id(),
    title: "Ролик",
    lang: "ru",
    kind: "explainer",
    status: "ready",
    media: { storageKey: "videos/x.mp4", durationSec: 30, sizeBytes: 100 },
    ...поля,
  });
}

describe("состав списка «Мои ролики»", () => {
  it("по умолчанию — только свои, даже у администратора клиники", async () => {
    const clinicId = id();
    const я = участник(clinicId, "admin");

    await ролик({ ownerId: я.ownerId, title: "Мой" });
    await ролик({ ownerId: id(), clinicId, visibility: "public", title: "Чужой" });

    const { items } = await listVideos({ actor: я });

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Мой");
  });

  it("библиотека клиники запрашивается явно", async () => {
    const clinicId = id();
    const я = участник(clinicId, "admin");

    await ролик({ ownerId: я.ownerId, title: "Мой" });
    await ролик({ ownerId: id(), clinicId, visibility: "clinic", title: "Клиники" });

    const { items } = await listVideos({ actor: я, query: { scope: "clinic" } });

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Клиники");
  });

  it("scope=all показывает и то и другое", async () => {
    const clinicId = id();
    const я = участник(clinicId, "admin");

    await ролик({ ownerId: я.ownerId, title: "Мой" });
    await ролик({ ownerId: id(), clinicId, visibility: "public", title: "Клиники" });

    const { items } = await listVideos({ actor: я, query: { scope: "all" } });
    expect(items.map((в) => в.title).sort()).toEqual(["Клиники", "Мой"]);
  });

  it("приватный ролик клиники не виден никому, кроме владельца", async () => {
    const clinicId = id();
    const я = участник(clinicId, "admin");
    await ролик({ ownerId: id(), clinicId, visibility: "private", title: "Черновик" });

    const { items } = await listVideos({ actor: я, query: { scope: "all" } });
    expect(items).toHaveLength(0);
  });

  it("без права на клинику её библиотека пуста, а не подменяется своими", async () => {
    const clinicId = id();
    // Роль без прав на видео: списка клиники быть не должно, и подменять
    // его своими роликами тоже нельзя — человек спросил не о том.
    const я = участник(clinicId, "patient");
    await ролик({ ownerId: я.ownerId, title: "Мой" });
    await ролик({ ownerId: id(), clinicId, visibility: "public", title: "Клиники" });

    const { items } = await listVideos({ actor: я, query: { scope: "clinic" } });
    expect(items).toHaveLength(0);
  });

  it("каждая запись говорит, своя ли она", async () => {
    const clinicId = id();
    const я = участник(clinicId, "admin");

    await ролик({ ownerId: я.ownerId, title: "Мой" });
    await ролик({ ownerId: id(), clinicId, visibility: "public", title: "Чужой" });

    const { items } = await listVideos({ actor: я, query: { scope: "all" } });
    const мой = items.find((в) => в.title === "Мой");
    const чужой = items.find((в) => в.title === "Чужой");

    expect(мой.isOwner).toBe(true);
    expect(чужой.isOwner).toBe(false);
  });
});
