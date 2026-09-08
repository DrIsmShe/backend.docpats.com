// Планы подготовки к процедуре: сроки от даты вмешательства и честный прогресс.
//
// Проверяем то, ради чего план и заводится: врач перед процедурой должен
// видеть, посмотрел пациент обязательные объяснения или нет. Значит важно,
// что прогресс нельзя проставить запросом, что правка шаблона не меняет уже
// выданное назначение и что необязательный ролик не портит готовность.

import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async (_c, command) => `https://signed.test/${command?.input?.Key}`),
}));

// Уведомления шлём по-настоящему, но получателя в базе нет — сервис
// уведомлений это переживает. Мокаем, чтобы тест не зависел от его
// внутренностей и не писал лишнего в базу.
vi.mock("../../modules/notifications/services/notification.service.js", () => ({
  notify: vi.fn(async () => ({ _id: "n1" })),
}));

import { notify } from "../../modules/notifications/services/notification.service.js";
import Video from "../../modules/video/models/video.model.js";
import {
  VideoPlaylist,
  VideoPlaylistAssignment,
} from "../../modules/video/models/videoPlaylist.model.js";
import {
  createPlaylist,
  assignPlaylist,
  listMyAssignments,
  listAppointmentAssignments,
  cancelAssignment,
  deactivatePlaylist,
} from "../../modules/video/services/videoPlaylist.service.js";
import { recordWatch } from "../../modules/video/services/videoPlayback.service.js";

const id = () => new mongoose.Types.ObjectId();

const клиника = id();
const пациентUser = id();
const картаПациента = id();

const врач = () => ({
  ownerType: "user",
  ownerId: id(),
  clinicId: клиника,
  role: "doctor",
  permissions: null,
  membershipId: id(),
  email: null,
});

const пациент = (userId = пациентUser) => ({
  ownerType: "user",
  ownerId: userId,
  clinicId: null,
  role: null,
  permissions: null,
  email: null,
});

async function ролик(название, сек = 60) {
  return Video.create({
    ownerType: "user",
    ownerId: id(),
    clinicId: клиника,
    title: название,
    status: "ready",
    visibility: "link",
    media: { storageKey: `videos/${название}.mp4`, durationSec: сек },
  });
}

/** Дата процедуры — через десять дней. */
const процедураЧерез10Дней = () => new Date(Date.now() + 10 * 86400000).toISOString();

beforeEach(() => {
  process.env.R2_BUCKET = "docpats-test";
  notify.mockClear();
});

describe("шаблон плана", () => {
  it("создаётся из готовых роликов", async () => {
    const а = await ролик("Диета");
    const б = await ролик("Подготовка");

    const plan = await createPlaylist({
      actor: врач(),
      data: {
        title: "Подготовка к гастроскопии",
        procedureName: "Гастроскопия",
        steps: [
          { videoId: а._id, offsetDays: 7 },
          { videoId: б._id, offsetDays: 1 },
        ],
      },
    });

    expect(plan.steps).toHaveLength(2);
    expect(plan.active).toBe(true);
  });

  it("план с неготовым роликом не создаётся", async () => {
    const готовый = await ролик("Диета");
    const черновик = await Video.create({
      ownerType: "user",
      ownerId: id(),
      clinicId: клиника,
      title: "Черновик",
      status: "draft",
    });

    await expect(
      createPlaylist({
        actor: врач(),
        data: {
          title: "План",
          procedureName: "Гастроскопия",
          steps: [
            { videoId: готовый._id, offsetDays: 3 },
            { videoId: черновик._id, offsetDays: 1 },
          ],
        },
      }),
    ).rejects.toThrow(/готовы/i);
  });

  it("пустой план отклоняется моделью", async () => {
    await expect(
      VideoPlaylist.create({
        clinicId: клиника,
        title: "Пустой",
        procedureName: "Гастроскопия",
        steps: [],
      }),
    ).rejects.toThrow(/хотя бы один/i);
  });
});

describe("назначение пациенту", () => {
  async function планИзДвух() {
    const а = await ролик("Диета");
    const б = await ролик("Накануне");
    const plan = await createPlaylist({
      actor: врач(),
      data: {
        title: "Подготовка к гастроскопии",
        procedureName: "Гастроскопия",
        steps: [
          { videoId: а._id, offsetDays: 7 },
          { videoId: б._id, offsetDays: 1 },
        ],
      },
    });
    return { plan, а, б };
  }

  it("сроки считаются от даты процедуры", async () => {
    const { plan } = await планИзДвух();
    const дата = процедураЧерез10Дней();

    const назначение = await assignPlaylist({
      actor: врач(),
      data: {
        playlistId: plan._id,
        clinicPatientId: картаПациента,
        patientUserId: пациентUser,
        procedureAt: дата,
      },
    });

    const процедура = new Date(дата).getTime();
    const дни = (шаг) => Math.round((процедура - шаг.dueAt.getTime()) / 86400000);
    expect(дни(назначение.steps[0])).toBe(7);
    expect(дни(назначение.steps[1])).toBe(1);
  });

  it("назначение уведомляет пациента", async () => {
    const { plan } = await планИзДвух();
    await assignPlaylist({
      actor: врач(),
      data: {
        playlistId: plan._id,
        clinicPatientId: картаПациента,
        patientUserId: пациентUser,
        procedureAt: процедураЧерез10Дней(),
      },
    });

    expect(notify).toHaveBeenCalledTimes(1);
    const вызов = notify.mock.calls[0][0];
    expect(String(вызов.userId)).toBe(String(пациентUser));
    expect(вызов.type).toBe("video_playlist_assigned");
  });

  it("процедура в прошлом отклоняется", async () => {
    const { plan } = await планИзДвух();
    await expect(
      assignPlaylist({
        actor: врач(),
        data: {
          playlistId: plan._id,
          clinicPatientId: картаПациента,
          patientUserId: пациентUser,
          procedureAt: new Date(Date.now() - 86400000).toISOString(),
        },
      }),
    ).rejects.toThrow(/прошла/i);
  });

  it("правка шаблона не меняет уже выданное назначение", async () => {
    // Человек готовится по тому, что ему сказали. Если бы шаги хранились
    // ссылкой на шаблон, отключение шаблона переписало бы его задание.
    const { plan } = await планИзДвух();
    const назначение = await assignPlaylist({
      actor: врач(),
      data: {
        playlistId: plan._id,
        clinicPatientId: картаПациента,
        patientUserId: пациентUser,
        procedureAt: процедураЧерез10Дней(),
      },
    });

    await deactivatePlaylist({ actor: врач(), id: plan._id });

    const свежее = await VideoPlaylistAssignment.findById(назначение._id);
    expect(свежее.steps).toHaveLength(2);
    expect(свежее.cancelledAt).toBeNull();
  });
});

describe("прогресс подготовки", () => {
  async function назначенныйПлан(шаги) {
    const ролики = [];
    for (const ш of шаги) ролики.push(await ролик(ш.название, 100));
    const plan = await createPlaylist({
      actor: врач(),
      data: {
        title: "План",
        procedureName: "Гастроскопия",
        steps: ролики.map((р, i) => ({
          videoId: р._id,
          offsetDays: шаги[i].offsetDays,
          required: шаги[i].required,
        })),
      },
    });
    const назначение = await assignPlaylist({
      actor: врач(),
      data: {
        playlistId: plan._id,
        clinicPatientId: картаПациента,
        patientUserId: пациентUser,
        appointmentId: шаги.appointmentId,
        procedureAt: процедураЧерез10Дней(),
      },
    });
    return { назначение, ролики };
  }

  it("досмотр закрывает шаг, половина — нет", async () => {
    const { назначение, ролики } = await назначенныйПлан([
      { название: "Диета", offsetDays: 7, required: true },
      { название: "Накануне", offsetDays: 1, required: true },
    ]);

    await recordWatch({ actor: пациент(), id: ролики[0]._id, watchedSec: 95 });
    await recordWatch({ actor: пациент(), id: ролики[1]._id, watchedSec: 40 });

    const свежее = await VideoPlaylistAssignment.findById(назначение._id);
    expect(свежее.steps[0].completedAt).toBeTruthy();
    expect(свежее.steps[1].completedAt).toBeNull();
    expect(свежее.progress).toEqual({ done: 1, total: 2, ready: false });
  });

  it("готовность считается только по обязательным шагам", async () => {
    const { назначение, ролики } = await назначенныйПлан([
      { название: "Обязательный", offsetDays: 3, required: true },
      { название: "Дополнительный", offsetDays: 3, required: false },
    ]);

    await recordWatch({ actor: пациент(), id: ролики[0]._id, watchedSec: 100 });

    const свежее = await VideoPlaylistAssignment.findById(назначение._id);
    expect(свежее.progress).toEqual({ done: 1, total: 1, ready: true });
  });

  it("чужой просмотр прогресс не двигает", async () => {
    const { назначение, ролики } = await назначенныйПлан([
      { название: "Диета", offsetDays: 7, required: true },
    ]);

    await recordWatch({ actor: пациент(id()), id: ролики[0]._id, watchedSec: 100 });

    const свежее = await VideoPlaylistAssignment.findById(назначение._id);
    expect(свежее.steps[0].completedAt).toBeNull();
  });

  it("отменённое назначение просмотром не двигается", async () => {
    const { назначение, ролики } = await назначенныйПлан([
      { название: "Диета", offsetDays: 7, required: true },
    ]);
    await cancelAssignment({ actor: врач(), id: назначение._id });

    await recordWatch({ actor: пациент(), id: ролики[0]._id, watchedSec: 100 });

    const свежее = await VideoPlaylistAssignment.findById(назначение._id);
    expect(свежее.steps[0].completedAt).toBeNull();
  });

  it("пациент видит свои назначения, чужие — нет", async () => {
    await назначенныйПлан([{ название: "Диета", offsetDays: 7, required: true }]);

    expect((await listMyAssignments({ actor: пациент() })).items).toHaveLength(1);
    expect((await listMyAssignments({ actor: пациент(id()) })).items).toHaveLength(0);
  });

  it("по приёму видно, готов ли пациент", async () => {
    const приём = id();
    const р = await ролик("Диета", 100);
    const plan = await createPlaylist({
      actor: врач(),
      data: {
        title: "План",
        procedureName: "Гастроскопия",
        steps: [{ videoId: р._id, offsetDays: 2 }],
      },
    });
    await assignPlaylist({
      actor: врач(),
      data: {
        playlistId: plan._id,
        clinicPatientId: картаПациента,
        patientUserId: пациентUser,
        appointmentId: приём,
        procedureAt: процедураЧерез10Дней(),
      },
    });

    const до = await listAppointmentAssignments({ actor: врач(), appointmentId: приём });
    expect(до.items[0].progress.ready).toBe(false);

    await recordWatch({ actor: пациент(), id: р._id, watchedSec: 100 });

    const после = await listAppointmentAssignments({ actor: врач(), appointmentId: приём });
    expect(после.items[0].progress.ready).toBe(true);
  });

  it("чужая клиника назначений не видит", async () => {
    const приём = id();
    const р = await ролик("Диета", 100);
    const plan = await createPlaylist({
      actor: врач(),
      data: {
        title: "План",
        procedureName: "Гастроскопия",
        steps: [{ videoId: р._id, offsetDays: 2 }],
      },
    });
    await assignPlaylist({
      actor: врач(),
      data: {
        playlistId: plan._id,
        clinicPatientId: картаПациента,
        patientUserId: пациентUser,
        appointmentId: приём,
        procedureAt: процедураЧерез10Дней(),
      },
    });

    const чужой = { ...врач(), clinicId: id() };
    const { items } = await listAppointmentAssignments({ actor: чужой, appointmentId: приём });
    expect(items).toHaveLength(0);
  });
});
