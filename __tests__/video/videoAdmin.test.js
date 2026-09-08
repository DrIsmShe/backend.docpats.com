// Администратор платформы над каталогом: правка, архив, удаление чужого.
//
// Здесь важнее обычного, что действие оставляет след и объяснение: убирают
// чужой материал, и вопрос «кто и почему» задают первым. Поэтому проверяем
// не только «получилось», но и что без причины не получается, что архив
// прячет ролик отовсюду и что его можно вернуть.

import { describe, it, expect, vi } from "vitest";
import mongoose from "mongoose";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async (_c, command) => `https://signed.test/${command?.input?.Key}`),
}));

import Video from "../../modules/video/models/video.model.js";
import HIPAAAuditLog from "../../modules/audit/models/AuditLog.model.js";
import {
  adminList,
  adminUpdate,
  adminArchive,
  adminUnarchive,
  adminDelete,
} from "../../modules/video/services/videoAdmin.service.js";
import {
  listPublicVideos,
  getPublicVideo,
  listVideos,
} from "../../modules/video/services/video.service.js";

const id = () => new mongoose.Types.ObjectId();
const админ = id();

/** Чужой опубликованный ролик — то, с чем работает администратор. */
async function чужойРолик(поля = {}) {
  return Video.create({
    ownerType: "user",
    ownerId: id(),
    title: "Чужой ролик",
    status: "ready",
    visibility: "public",
    publishedAt: new Date(),
    media: { storageKey: "videos/a.mp4", durationSec: 60 },
    ...поля,
  });
}

const владелец = (video) => ({
  ownerType: "user",
  ownerId: video.ownerId,
  clinicId: null,
  role: null,
  permissions: null,
  email: null,
});

describe("список для администратора", () => {
  it("показывает чужое и черновики — модерировать можно только видимое", async () => {
    await чужойРолик();
    await чужойРолик({ status: "draft", visibility: "private", publishedAt: null });

    const { items } = await adminList({ adminId: админ });
    expect(items).toHaveLength(2);
  });

  it("архив по умолчанию скрыт, но запрашивается отдельно", async () => {
    const video = await чужойРолик();
    await adminArchive({ adminId: админ, id: video._id, reason: "устарело" });

    expect((await adminList({ adminId: админ })).items).toHaveLength(0);
    expect(
      (await adminList({ adminId: админ, query: { archived: true } })).items,
    ).toHaveLength(1);
    expect(
      (await adminList({ adminId: админ, query: { archived: "all" } })).items,
    ).toHaveLength(1);
  });

  it("поиск по названию не ломается на спецсимволах", async () => {
    await чужойРолик({ title: "Разбор (КТ) — случай" });
    const { items } = await adminList({ adminId: админ, query: { q: "(КТ)" } });
    expect(items).toHaveLength(1);
  });
});

describe("правка администратором", () => {
  it("может менять видимость — этим он и снимает с витрины", async () => {
    const video = await чужойРолик();
    const итог = await adminUpdate({
      adminId: админ,
      id: video._id,
      patch: { visibility: "private", title: "Поправлено" },
    });

    expect(итог.visibility).toBe("private");
    expect(итог.title).toBe("Поправлено");
    expect((await listPublicVideos()).items).toHaveLength(0);
  });

  it("отметка PHI закрывает ролик, даже если админ просит публичный", async () => {
    // Правило модели сильнее решения администратора: ролик с пациентом
    // в кадре не публикуется никем.
    const video = await чужойРолик();
    const итог = await adminUpdate({
      adminId: админ,
      id: video._id,
      patch: { phi: true, visibility: "public" },
    });
    expect(итог.visibility).toBe("private");
  });
});

describe("архив", () => {
  it("прячет ролик из витрины, со страницы и из кабинета владельца", async () => {
    const video = await чужойРолик();
    await adminArchive({ adminId: админ, id: video._id, reason: "устаревшая рекомендация" });

    expect((await listPublicVideos()).items).toHaveLength(0);
    await expect(getPublicVideo({ id: video._id })).rejects.toThrow(/не найдено/i);
    expect((await listVideos({ actor: владелец(video) })).items).toHaveLength(0);
  });

  it("без причины архивировать нельзя", async () => {
    const video = await чужойРолик();
    await expect(
      adminArchive({ adminId: админ, id: video._id, reason: "  " }),
    ).rejects.toThrow(/причину/i);
  });

  it("дважды в архив не положишь", async () => {
    const video = await чужойРолик();
    await adminArchive({ adminId: админ, id: video._id, reason: "повод" });
    await expect(
      adminArchive({ adminId: админ, id: video._id, reason: "ещё раз" }),
    ).rejects.toThrow(/уже в архиве/i);
  });

  it("возврат из архива не восстанавливает публикацию сам", async () => {
    // Видимость выбирают заново: ошибка модерации отменяется, но решение
    // «показывать снова» должен принять человек.
    const video = await чужойРолик();
    await adminArchive({ adminId: админ, id: video._id, reason: "повод" });
    const итог = await adminUnarchive({ adminId: админ, id: video._id });

    expect(итог.archivedAt).toBeNull();
    expect(итог.visibility).toBe("private");
    expect((await listPublicVideos()).items).toHaveLength(0);
  });
});

describe("удаление администратором", () => {
  it("без причины не удаляет", async () => {
    const video = await чужойРолик();
    await expect(
      adminDelete({ adminId: админ, id: video._id, reason: "" }),
    ).rejects.toThrow(/причину/i);
  });

  it("удаляет и ставит файлы в очередь уборки", async () => {
    process.env.R2_PUBLIC_URL = "https://files.test";
    const OrphanR2File = (
      await import("../../common/models/system/OrphanR2File.js")
    ).default;

    const video = await чужойРолик();
    await adminDelete({ adminId: админ, id: video._id, reason: "нарушение лицензии" });

    expect(await Video.findById(video._id)).toBeNull();
    expect(await OrphanR2File.countDocuments({ sourceId: video._id })).toBe(1);
  });
});

describe("журнал админских действий", () => {
  it("отделён от обычных действий и хранит владельца ролика", async () => {
    const video = await чужойРолик();
    await adminUpdate({ adminId: админ, id: video._id, patch: { title: "Новое" } });
    await adminArchive({ adminId: админ, id: video._id, reason: "повод" });

    const записи = await HIPAAAuditLog.find({
      action: { $in: ["video.admin.update", "video.admin.archive"] },
    }).lean();

    expect(записи).toHaveLength(2);
    // По владельцу собирается ответ на вопрос «что делали с материалами
    // этого врача».
    expect(записи.every((з) => String(з.resourceOwnerId) === String(video.ownerId))).toBe(true);
    expect(записи.every((з) => String(з.userId) === String(админ))).toBe(true);
  });

  it("причина архивации в журнал не копируется", async () => {
    const video = await чужойРолик();
    await adminArchive({
      adminId: админ,
      id: video._id,
      reason: "жалоба пациента Иванова на содержание",
    });

    const запись = await HIPAAAuditLog.findOne({ action: "video.admin.archive" }).lean();
    expect(запись.metadata.hasReason).toBe(true);
    expect(JSON.stringify(запись.metadata)).not.toMatch(/Иванов/);
  });
});
