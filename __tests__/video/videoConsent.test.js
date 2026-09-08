// Видео-согласие: подпись возможна только после настоящего досмотра.
//
// Это ядро всей затеи. Обычная галочка под текстом доказывает лишь то, что
// кто-то нажал кнопку; ценность здесь ровно в том, что подпись физически
// недостижима без просмотра. Поэтому проверяем не «как оно работает», а
// «чего оно не позволяет»:
//   • подписать, не досмотрев;
//   • подписать за пациента;
//   • подделать прогресс, минуя учёт просмотра;
//   • сдвинуть время досмотра повторным просмотром.

import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async (_c, command) => `https://signed.test/${command?.input?.Key}`),
}));

import Video from "../../modules/video/models/video.model.js";
import VideoConsent from "../../modules/video/models/videoConsent.model.js";
import HIPAAAuditLog from "../../modules/audit/models/AuditLog.model.js";
import {
  requestConsent,
  signConsent,
  revokeConsent,
  listMyConsents,
  getConsent,
} from "../../modules/video/services/videoConsent.service.js";
import { recordWatch } from "../../modules/video/services/videoPlayback.service.js";

const id = () => new mongoose.Types.ObjectId();

const клиника = id();
const пациентUser = id();
const картаПациента = id();

/** Врач клиники — он запрашивает согласие. */
const врач = () => ({
  ownerType: "user",
  ownerId: id(),
  clinicId: клиника,
  role: "doctor",
  permissions: null,
  membershipId: id(),
  email: "doc@example.test",
});

/** Пациент — он смотрит и подписывает. */
const пациент = (userId = пациентUser) => ({
  ownerType: "user",
  ownerId: userId,
  clinicId: null,
  role: null,
  permissions: null,
  email: null,
});

/** Готовый ролик клиники, доступный пациенту по ссылке. */
async function роликПро(вмешательство) {
  return Video.create({
    ownerType: "user",
    ownerId: id(),
    clinicId: клиника,
    title: вмешательство,
    status: "ready",
    visibility: "link",
    media: { storageKey: "videos/expl.mp4", durationSec: 100 },
  });
}

async function запросить(video, поля = {}) {
  return requestConsent({
    actor: врач(),
    data: {
      videoId: video._id,
      clinicPatientId: картаПациента,
      patientUserId: пациентUser,
      procedureName: "Гастроскопия",
      ...поля,
    },
  });
}

beforeEach(() => {
  process.env.R2_BUCKET = "docpats-test";
});

describe("запрос согласия", () => {
  it("создаётся в состоянии ожидания и хранит снимок ролика", async () => {
    const video = await роликПро("Что такое гастроскопия");
    const consent = await запросить(video);

    expect(consent.status).toBe("pending");
    expect(consent.signedAt).toBeNull();
    // Снимок — предмет согласия: что именно человеку показали.
    expect(consent.video.title).toBe("Что такое гастроскопия");
    expect(consent.video.durationSec).toBe(100);
    expect(consent.video.storageKey).toBe("videos/expl.mp4");
  });

  it("нельзя требовать согласия под неготовый ролик", async () => {
    const video = await Video.create({
      ownerType: "user",
      ownerId: id(),
      clinicId: клиника,
      title: "Черновик",
      status: "draft",
    });
    await expect(запросить(video)).rejects.toThrow(/не готов/i);
  });

  it("нельзя требовать согласия под ролик неизвестной длительности", async () => {
    // Без длительности «досмотрел до конца» не с чем сравнить, и вся
    // конструкция превращается обратно в галочку.
    const video = await Video.create({
      ownerType: "user",
      ownerId: id(),
      clinicId: клиника,
      title: "Без длительности",
      status: "ready",
      media: { storageKey: "videos/x.mp4", durationSec: 0 },
    });
    await expect(запросить(video)).rejects.toThrow(/длительност/i);
  });

  it("без права записи клиника согласия не запросит", async () => {
    const video = await роликПро("Ролик");
    const бухгалтер = { ...врач(), role: "accountant" };
    await expect(
      requestConsent({
        actor: бухгалтер,
        data: {
          videoId: video._id,
          clinicPatientId: картаПациента,
          patientUserId: пациентUser,
          procedureName: "Гастроскопия",
        },
      }),
    ).rejects.toThrow(/Нет права/i);
  });
});

describe("подпись", () => {
  it("недосмотренное согласие подписать нельзя", async () => {
    const video = await роликПро("Ролик");
    const consent = await запросить(video);

    await expect(
      signConsent({ actor: пациент(), id: consent._id }),
    ).rejects.toThrow(/посмотрите ролик/i);
  });

  it("половина ролика не открывает подпись", async () => {
    const video = await роликПро("Ролик");
    const consent = await запросить(video);

    await recordWatch({ actor: пациент(), id: video._id, watchedSec: 50 });

    const свежее = await VideoConsent.findById(consent._id);
    expect(свежее.status).toBe("pending");
    expect(свежее.watch.completedAt).toBeNull();
    await expect(
      signConsent({ actor: пациент(), id: consent._id }),
    ).rejects.toThrow(/посмотрите ролик/i);
  });

  it("досмотр открывает подпись, и она проходит", async () => {
    const video = await роликПро("Ролик");
    const consent = await запросить(video);

    const итог = await recordWatch({ actor: пациент(), id: video._id, watchedSec: 95 });
    expect(итог.consentsReady).toBe(1);

    const подписанное = await signConsent({ actor: пациент(), id: consent._id });
    expect(подписанное.status).toBe("signed");
    expect(подписанное.signedAt).toBeTruthy();
  });

  it("подписать за пациента не может никто — даже запросивший врач", async () => {
    const video = await роликПро("Ролик");
    const consent = await запросить(video);
    await recordWatch({ actor: пациент(), id: video._id, watchedSec: 100 });

    await expect(
      signConsent({ actor: врач(), id: consent._id }),
    ).rejects.toThrow(/не найдено/i);
    await expect(
      signConsent({ actor: пациент(id()), id: consent._id }),
    ).rejects.toThrow(/не найдено/i);
  });

  it("дважды подписать нельзя", async () => {
    const video = await роликПро("Ролик");
    const consent = await запросить(video);
    await recordWatch({ actor: пациент(), id: video._id, watchedSec: 100 });
    await signConsent({ actor: пациент(), id: consent._id });

    await expect(
      signConsent({ actor: пациент(), id: consent._id }),
    ).rejects.toThrow(/уже подписано/i);
  });

  it("просроченный запрос не подписывается и помечается истёкшим", async () => {
    const video = await роликПро("Ролик");
    const consent = await запросить(video);
    await recordWatch({ actor: пациент(), id: video._id, watchedSec: 100 });

    consent.expiresAt = new Date(Date.now() - 1000);
    await consent.save();

    await expect(
      signConsent({ actor: пациент(), id: consent._id }),
    ).rejects.toThrow(/срок/i);
    expect((await VideoConsent.findById(consent._id)).status).toBe("expired");
  });

  it("модель не даёт сохранить подпись без досмотра даже в обход сервиса", async () => {
    // Последняя линия: правило живёт в модели, поэтому не обходится ни
    // скриптом, ни cron, ни будущим кодом мимо сервисного слоя.
    const video = await роликПро("Ролик");
    const consent = await запросить(video);
    consent.signedAt = new Date();
    consent.status = "signed";

    await expect(consent.save()).rejects.toThrow(/досмотрен/i);
  });
});

describe("учёт просмотра и согласие", () => {
  it("время досмотра не сдвигается повторным просмотром", async () => {
    const video = await роликПро("Ролик");
    const consent = await запросить(video);

    await recordWatch({ actor: пациент(), id: video._id, watchedSec: 100 });
    const первое = (await VideoConsent.findById(consent._id)).watch.completedAt;

    await recordWatch({ actor: пациент(), id: video._id, watchedSec: 100 });
    const второе = (await VideoConsent.findById(consent._id)).watch.completedAt;

    expect(второе.getTime()).toBe(первое.getTime());
    expect((await VideoConsent.findById(consent._id)).watch.attempts).toBe(2);
  });

  it("чужой просмотр того же ролика согласие не двигает", async () => {
    const video = await роликПро("Ролик");
    const consent = await запросить(video);

    await recordWatch({ actor: пациент(id()), id: video._id, watchedSec: 100 });

    const свежее = await VideoConsent.findById(consent._id);
    expect(свежее.status).toBe("pending");
    expect(свежее.watch.completedAt).toBeNull();
  });

  it("один просмотр закрывает оба согласия по этому ролику", async () => {
    const video = await роликПро("Общий ролик");
    const первое = await запросить(video, { procedureName: "Гастроскопия" });
    const второе = await запросить(video, { procedureName: "Колоноскопия" });

    const итог = await recordWatch({ actor: пациент(), id: video._id, watchedSec: 100 });

    expect(итог.consentsReady).toBe(2);
    expect((await VideoConsent.findById(первое._id)).status).toBe("watched");
    expect((await VideoConsent.findById(второе._id)).status).toBe("watched");
  });
});

describe("отзыв и доступ", () => {
  it("подписанное согласие пациент может отозвать", async () => {
    const video = await роликПро("Ролик");
    const consent = await запросить(video);
    await recordWatch({ actor: пациент(), id: video._id, watchedSec: 100 });
    await signConsent({ actor: пациент(), id: consent._id });

    const отозванное = await revokeConsent({
      actor: пациент(),
      id: consent._id,
      reason: "передумал",
    });
    expect(отозванное.status).toBe("revoked");
    expect(отозванное.revokedAt).toBeTruthy();
  });

  it("неподписанное отозвать нечего", async () => {
    const video = await роликПро("Ролик");
    const consent = await запросить(video);
    await expect(
      revokeConsent({ actor: пациент(), id: consent._id }),
    ).rejects.toThrow(/подписанное/i);
  });

  it("пациент видит свои согласия, чужие — нет", async () => {
    const video = await роликПро("Ролик");
    await запросить(video);

    const мои = await listMyConsents({ actor: пациент() });
    expect(мои.items).toHaveLength(1);

    const чужие = await listMyConsents({ actor: пациент(id()) });
    expect(чужие.items).toHaveLength(0);
  });

  it("клиника не видит согласия чужой клиники", async () => {
    const video = await роликПро("Ролик");
    const consent = await запросить(video);

    const чужойВрач = { ...врач(), clinicId: id() };
    await expect(
      getConsent({ actor: чужойВрач, id: consent._id }),
    ).rejects.toThrow(/не найдено/i);
  });
});

describe("журнал согласия", () => {
  it("запрос, досмотр и подпись оставляют след с разбором по времени", async () => {
    const video = await роликПро("Ролик");
    const consent = await запросить(video);
    await recordWatch({ actor: пациент(), id: video._id, watchedSec: 100 });
    await signConsent({ actor: пациент(), id: consent._id });

    const записи = await HIPAAAuditLog.find({ resourceType: "video-consent" }).lean();
    const действия = записи.map((з) => з.action);

    expect(действия).toContain("video.consent.request");
    expect(действия).toContain("video.consent.watched");
    expect(действия).toContain("video.consent.sign");

    // Владелец записи — пациент: по нему собирается ответ на вопрос
    // «что подписывал этот человек».
    expect(записи.every((з) => String(з.resourceOwnerId) === String(пациентUser))).toBe(true);

    // Ключевая величина для разбора спора: сколько прошло от досмотра до
    // подписи. Ноль или отрицательное значение означало бы, что подпись
    // случилась раньше просмотра.
    const подпись = записи.find((з) => з.action === "video.consent.sign");
    expect(подпись.metadata.secondsFromWatchToSign).toBeGreaterThanOrEqual(0);
    expect(подпись.metadata.watchedRatio).toBe(1);
  });

  it("причина отзыва в журнал не копируется", async () => {
    const video = await роликПро("Ролик");
    const consent = await запросить(video);
    await recordWatch({ actor: пациент(), id: video._id, watchedSec: 100 });
    await signConsent({ actor: пациент(), id: consent._id });
    await revokeConsent({
      actor: пациент(),
      id: consent._id,
      reason: "у меня подтвердили язву, боюсь процедуры",
    });

    const запись = await HIPAAAuditLog.findOne({ action: "video.consent.revoke" }).lean();
    expect(запись.metadata.hasReason).toBe(true);
    expect(JSON.stringify(запись.metadata)).not.toMatch(/язв/i);
  });
});
