// Каталог фильмов: права, видимость и изоляция клиник.
//
// Проверяем ровно те правила, нарушение которых стоит дорого:
//   • приватность по умолчанию — ролик не выходит наружу сам собой;
//   • ролик с пациентом в кадре не публикуется ничем и никем;
//   • клиника A не видит роликов клиники B;
//   • действия действительно попадают в журнал (а не гаснут в warning).
//
// Файлы в этом каталоге относятся к разным подсистемам: jitsiToken и
// videoQuota — про видеозвонки, этот — про каталог снятых фильмов.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";

import Video from "../../modules/video/models/video.model.js";
import HIPAAAuditLog from "../../modules/audit/models/AuditLog.model.js";
import {
  createVideo,
  listVideos,
  getVideo,
  updateVideo,
  publishVideo,
  deleteVideo,
  attachVideo,
  listPublicVideos,
  listVideosForEntity,
  applyStudioRender,
} from "../../modules/video/services/video.service.js";

const id = () => new mongoose.Types.ObjectId();

/** Врач клиники: роль doctor имеет полный доступ к ресурсу video. */
function врач(clinicId, ownerId = id()) {
  return {
    ownerType: "user",
    ownerId,
    clinicId,
    role: "doctor",
    permissions: null,
    membershipId: id(),
    email: "doc@example.test",
  };
}

/** Одиночка без клиники — пациент или врач вне клиники. */
function одиночка(ownerId = id()) {
  return {
    ownerType: "user",
    ownerId,
    clinicId: null,
    role: null,
    permissions: null,
    email: null,
  };
}

describe("каталог видео — модель", () => {
  it("новый ролик приватен, пока его не опубликовали", async () => {
    const video = await createVideo({
      actor: одиночка(),
      data: { title: "Что такое аритмия" },
    });
    expect(video.visibility).toBe("private");
    expect(video.status).toBe("draft");
  });

  it("видимость из тела запроса игнорируется при создании", async () => {
    // Попытка открыть ролик наружу одной строкой в теле — обходя publish
    // с его проверками. Поле не входит в набор, который читает сервис.
    const video = await createVideo({
      actor: одиночка(),
      data: { title: "Ролик", visibility: "public" },
    });
    expect(video.visibility).toBe("private");
  });

  it("запись приёма всегда помечается как PHI, что бы ни прислали", async () => {
    const video = await createVideo({
      actor: одиночка(),
      data: { title: "Приём", kind: "encounter_record", phi: false },
    });
    expect(video.phi).toBe(true);
  });

  it("ролик с пациентом в кадре нельзя сохранить публичным", async () => {
    const video = new Video({
      ownerType: "user",
      ownerId: id(),
      title: "Разбор случая",
      phi: true,
      visibility: "public",
    });
    await expect(video.save()).rejects.toThrow(/пациент/i);
  });

  it("видимость clinic без клиники отклоняется", async () => {
    const video = new Video({
      ownerType: "user",
      ownerId: id(),
      title: "Ролик",
      visibility: "clinic",
      clinicId: null,
    });
    await expect(video.save()).rejects.toThrow(/clinicId/);
  });
});

describe("каталог видео — изоляция клиник", () => {
  it("ролик клиники A не виден врачу клиники B", async () => {
    const клиникаA = id();
    const клиникаB = id();
    const врачA = врач(клиникаA);

    const video = await createVideo({
      actor: врачA,
      data: { title: "Подготовка к гастроскопии" },
    });
    video.status = "ready";
    await video.save();
    await publishVideo({ actor: врачA, id: video._id, visibility: "clinic" });

    // Чужая клиника получает 404, а не отказ: существование ролика — тоже
    // сведения, которых у неё быть не должно.
    await expect(
      getVideo({ actor: врач(клиникаB), id: video._id }),
    ).rejects.toThrow(/не найдено/i);

    const { items } = await listVideos({ actor: врач(клиникаB) });
    expect(items).toHaveLength(0);
  });

  it("коллега из той же клиники ролик видит", async () => {
    const клиника = id();
    const автор = врач(клиника);
    const коллега = врач(клиника);

    const video = await createVideo({ actor: автор, data: { title: "Ролик" } });
    video.status = "ready";
    await video.save();
    await publishVideo({ actor: автор, id: video._id, visibility: "clinic" });

    const найден = await getVideo({ actor: коллега, id: video._id });
    expect(String(найден._id)).toBe(String(video._id));
  });

  it("владелец видит свой приватный ролик, посторонний — нет", async () => {
    const автор = одиночка();
    const посторонний = одиночка();
    const video = await createVideo({ actor: автор, data: { title: "Личное" } });

    expect(String((await getVideo({ actor: автор, id: video._id }))._id)).toBe(
      String(video._id),
    );
    await expect(
      getVideo({ actor: посторонний, id: video._id }),
    ).rejects.toThrow(/не найдено/i);
  });
});

describe("каталог видео — публикация", () => {
  it("ролик с пациентом не публикуется даже владельцем", async () => {
    const автор = одиночка();
    const video = await createVideo({
      actor: автор,
      data: { title: "Разбор", phi: true },
    });
    video.status = "ready";
    await video.save();

    await expect(
      publishVideo({ actor: автор, id: video._id, visibility: "public" }),
    ).rejects.toThrow(/пациент/i);
  });

  it("нельзя опубликовать ролик без готового файла", async () => {
    const автор = одиночка();
    const video = await createVideo({ actor: автор, data: { title: "Ролик" } });
    await expect(
      publishVideo({ actor: автор, id: video._id, visibility: "public" }),
    ).rejects.toThrow(/не готов/i);
  });

  it("отметка PHI на опубликованном ролике немедленно закрывает его", async () => {
    const автор = одиночка();
    const video = await createVideo({ actor: автор, data: { title: "Ролик" } });
    video.status = "ready";
    await video.save();
    await publishVideo({ actor: автор, id: video._id, visibility: "public" });

    const после = await updateVideo({
      actor: автор,
      id: video._id,
      patch: { phi: true },
    });
    expect(после.visibility).toBe("private");
    expect(после.publishedAt).toBeNull();
  });

  it("витрина отдаёт только опубликованное, готовое и без PHI", async () => {
    const автор = одиночка();
    const открытый = await createVideo({ actor: автор, data: { title: "Открытый" } });
    открытый.status = "ready";
    await открытый.save();
    await publishVideo({ actor: автор, id: открытый._id, visibility: "public" });

    await createVideo({ actor: автор, data: { title: "Черновик" } });

    const { items } = await listPublicVideos();
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Открытый");
  });
});

describe("каталог видео — привязка к сущностям", () => {
  it("повторная привязка к той же сущности не создаёт дубля", async () => {
    const автор = врач(id());
    const приём = id();
    const video = await createVideo({ actor: автор, data: { title: "Перед операцией" } });

    await attachVideo({
      actor: автор,
      id: video._id,
      entityType: "clinic-appointment",
      entityId: приём,
    });
    const после = await attachVideo({
      actor: автор,
      id: video._id,
      entityType: "clinic-appointment",
      entityId: приём,
    });

    expect(после.attachments).toHaveLength(1);
  });

  it("по приёму находятся его ролики", async () => {
    const автор = врач(id());
    const приём = id();
    const video = await createVideo({ actor: автор, data: { title: "Ролик" } });
    await attachVideo({
      actor: автор,
      id: video._id,
      entityType: "clinic-appointment",
      entityId: приём,
    });

    const { items } = await listVideosForEntity({
      actor: автор,
      entityType: "clinic-appointment",
      entityId: приём,
    });
    expect(items).toHaveLength(1);
  });
});

describe("каталог видео — рендер из студии", () => {
  it("готовый файл переводит запись в состояние ready", async () => {
    const автор = одиночка();
    const video = await createVideo({
      actor: автор,
      data: { title: "Ролик", source: { kind: "studio", studioFilmId: "film-1" } },
    });
    expect(video.status).toBe("draft");

    const после = await applyStudioRender({
      studioFilmId: "film-1",
      media: { storageKey: "videos/film-1.mp4", durationSec: 62 },
    });
    expect(после.status).toBe("ready");
    expect(после.media.durationSec).toBe(62);
  });

  it("повторная доставка того же события ничего не ломает", async () => {
    const автор = одиночка();
    await createVideo({
      actor: автор,
      data: { title: "Ролик", source: { kind: "studio", studioFilmId: "film-2" } },
    });

    const первый = await applyStudioRender({
      studioFilmId: "film-2",
      media: { storageKey: "videos/film-2.mp4", durationSec: 30 },
    });
    const второй = await applyStudioRender({
      studioFilmId: "film-2",
      media: { storageKey: "videos/film-2.mp4", durationSec: 30 },
    });

    expect(String(первый._id)).toBe(String(второй._id));
    expect(await Video.countDocuments({ "source.studioFilmId": "film-2" })).toBe(1);
  });

  it("неудачный рендер сохраняет причину", async () => {
    await createVideo({
      actor: одиночка(),
      data: { title: "Ролик", source: { kind: "studio", studioFilmId: "film-3" } },
    });
    const после = await applyStudioRender({
      studioFilmId: "film-3",
      status: "failed",
      failureReason: "кончилось место",
    });
    expect(после.status).toBe("failed");
    expect(после.failureReason).toBe("кончилось место");
  });
});

describe("каталог видео — уборка файлов", () => {
  it("удаление ролика ставит его файлы в очередь уборки R2", async () => {
    process.env.R2_PUBLIC_URL = "https://files.test";
    const OrphanR2File = (
      await import("../../common/models/system/OrphanR2File.js")
    ).default;

    const автор = одиночка();
    const video = await createVideo({ actor: автор, data: { title: "Ролик" } });
    video.media.storageKey = "videos/a.mp4";
    video.media.posterKey = "videos/a.jpg";
    video.locales = [{ lang: "ru", subtitleKey: "subs/a-ru.vtt" }];
    await video.save();

    await deleteVideo({ actor: автор, id: video._id });

    const сироты = await OrphanR2File.find({ sourceId: video._id }).lean();
    expect(сироты.map((с) => с.fileUrl).sort()).toEqual([
      "https://files.test/subs/a-ru.vtt",
      "https://files.test/videos/a.jpg",
      "https://files.test/videos/a.mp4",
    ]);
    expect(сироты.every((с) => с.sourceModel === "Video")).toBe(true);
  });

  it("ролик без файлов удаляется, ничего не ставя в очередь", async () => {
    process.env.R2_PUBLIC_URL = "https://files.test";
    const OrphanR2File = (
      await import("../../common/models/system/OrphanR2File.js")
    ).default;

    const автор = одиночка();
    const video = await createVideo({ actor: автор, data: { title: "Черновик" } });
    await deleteVideo({ actor: автор, id: video._id });

    expect(await OrphanR2File.countDocuments({ sourceId: video._id })).toBe(0);
  });
});

describe("каталог видео — журнал", () => {
  // Чистить журнал здесь нечем и незачем: модель запрещает удаление
  // (append-only, это её суть), а общий afterEach в setup.js опорожняет
  // коллекции нативным драйвером в обход mongoose-хуков.

  it("создание, публикация и удаление попадают в журнал", async () => {
    const автор = одиночка();
    const video = await createVideo({ actor: автор, data: { title: "Ролик" } });
    video.status = "ready";
    await video.save();
    await publishVideo({ actor: автор, id: video._id, visibility: "public" });
    await deleteVideo({ actor: автор, id: video._id });

    const записи = await HIPAAAuditLog.find({ resourceType: "video" }).lean();
    const действия = записи.map((з) => з.action);

    expect(действия).toContain("video.create");
    expect(действия).toContain("video.publish");
    expect(действия).toContain("video.delete");
    // Журнал должен опознавать действующее лицо: запись без userId не
    // проходит валидацию и терялась бы молча.
    expect(записи.every((з) => з.userId)).toBe(true);
  });

  it("в журнале нет названия ролика — только структурные данные", async () => {
    const автор = одиночка();
    await createVideo({ actor: автор, data: { title: "Иванов Иван, гастроскопия" } });

    const запись = await HIPAAAuditLog.findOne({ action: "video.create" }).lean();
    expect(JSON.stringify(запись.metadata || {})).not.toMatch(/Иванов/);
  });
});

describe("видео-визитка врача", () => {
  it("своим опубликованным роликом визитку поставить можно", async () => {
    const DoctorProfile = (
      await import("../../common/models/DoctorProfile/profileDoctor.js")
    ).default;
    const { setIntroVideo } = await import(
      "../../modules/video/services/video.service.js"
    );

    const врач = одиночка();
    await DoctorProfile.create({ userId: врач.ownerId });

    const video = await createVideo({ actor: врач, data: { title: "Обо мне" } });
    video.status = "ready";
    await video.save();
    await publishVideo({ actor: врач, id: video._id, visibility: "public" });

    const итог = await setIntroVideo({ actor: врач, id: video._id });
    expect(String(итог.introVideoId)).toBe(String(video._id));

    const профиль = await DoctorProfile.findOne({ userId: врач.ownerId });
    expect(String(профиль.introVideoId)).toBe(String(video._id));
  });

  it("закрытый ролик визиткой не станет", async () => {
    // Посетитель профиля его всё равно не откроет — визитка выглядела бы
    // сломанной картинкой.
    const DoctorProfile = (
      await import("../../common/models/DoctorProfile/profileDoctor.js")
    ).default;
    const { setIntroVideo } = await import(
      "../../modules/video/services/video.service.js"
    );

    const врач = одиночка();
    await DoctorProfile.create({ userId: врач.ownerId });
    const video = await createVideo({ actor: врач, data: { title: "Черновик" } });
    video.status = "ready";
    await video.save();

    await expect(setIntroVideo({ actor: врач, id: video._id })).rejects.toThrow(
      /откройте ролик/i,
    );
  });

  it("ролик с пациентом визиткой не станет", async () => {
    const DoctorProfile = (
      await import("../../common/models/DoctorProfile/profileDoctor.js")
    ).default;
    const { setIntroVideo } = await import(
      "../../modules/video/services/video.service.js"
    );

    const врач = одиночка();
    await DoctorProfile.create({ userId: врач.ownerId });
    const video = await createVideo({
      actor: врач,
      data: { title: "Разбор", phi: true },
    });
    video.status = "ready";
    await video.save();

    await expect(setIntroVideo({ actor: врач, id: video._id })).rejects.toThrow(
      /пациент/i,
    );
  });

  it("чужой ролик визиткой не станет", async () => {
    const DoctorProfile = (
      await import("../../common/models/DoctorProfile/profileDoctor.js")
    ).default;
    const { setIntroVideo } = await import(
      "../../modules/video/services/video.service.js"
    );

    const автор = одиночка();
    const чужой = одиночка();
    await DoctorProfile.create({ userId: чужой.ownerId });

    const video = await createVideo({ actor: автор, data: { title: "Обо мне" } });
    video.status = "ready";
    await video.save();
    await publishVideo({ actor: автор, id: video._id, visibility: "public" });

    await expect(setIntroVideo({ actor: чужой, id: video._id })).rejects.toThrow(
      /свой ролик/i,
    );
  });
});
