// Воспроизведение: кому выдаётся ссылка на файл и как считается просмотр.
//
// Подписывание вынесено в мок: проверяем не то, что AWS SDK умеет считать
// подпись (это его работа), а наши решения — кому вообще выдать ссылку, на
// какой файл и на какой срок. Ролик с пациентом обязан получать короткий
// срок и цельный файл вместо HLS, чьи сегменты сейчас раздаются без подписи.

import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

// Мок ДО импорта тестируемого модуля: иначе он возьмёт настоящий presigner
// и попытается сходить в сеть.
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async (_client, command, opts) => {
    const key = command?.input?.Key || "unknown";
    return `https://signed.test/${key}?ttl=${opts?.expiresIn}`;
  }),
}));

import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import Video from "../../modules/video/models/video.model.js";
import HIPAAAuditLog from "../../modules/audit/models/AuditLog.model.js";
import {
  getPlaybackUrls,
  recordWatch,
} from "../../modules/video/services/videoPlayback.service.js";

const id = () => new mongoose.Types.ObjectId();

function актёр(ownerId) {
  return {
    ownerType: "user",
    ownerId,
    clinicId: null,
    role: null,
    permissions: null,
    email: null,
  };
}

/** Готовый к показу ролик со всеми файлами. */
async function готовыйРолик(overrides = {}) {
  return Video.create({
    ownerType: "user",
    ownerId: overrides.ownerId || id(),
    title: "Ролик",
    status: "ready",
    media: {
      storageKey: "videos/film.mp4",
      hlsKey: "videos/film.m3u8",
      posterKey: "videos/film.jpg",
      durationSec: 100,
    },
    ...overrides,
  });
}

beforeEach(() => {
  process.env.R2_BUCKET = "docpats-test";
  getSignedUrl.mockClear();
});

describe("ссылка на воспроизведение", () => {
  it("владелец получает подписанную ссылку и постер", async () => {
    const хозяин = id();
    const video = await готовыйРолик({ ownerId: хозяин });

    const данные = await getPlaybackUrls({ actor: актёр(хозяин), id: video._id });

    expect(данные.url).toContain("signed.test");
    expect(данные.poster).toContain("film.jpg");
    expect(данные.durationSec).toBe(100);
  });

  it("посторонний не получает ничего", async () => {
    const video = await готовыйРолик();
    await expect(
      getPlaybackUrls({ actor: актёр(id()), id: video._id }),
    ).rejects.toThrow(/не найдено/i);
  });

  it("ролик без готового файла ссылку не отдаёт", async () => {
    const хозяин = id();
    const video = await Video.create({
      ownerType: "user",
      ownerId: хозяин,
      title: "Черновик",
      status: "draft",
    });
    await expect(
      getPlaybackUrls({ actor: актёр(хозяин), id: video._id }),
    ).rejects.toThrow(/не готов/i);
  });

  it("обычному ролику отдаётся нарезка HLS", async () => {
    const хозяин = id();
    const video = await готовыйРолик({ ownerId: хозяин });
    const данные = await getPlaybackUrls({ actor: актёр(хозяин), id: video._id });
    expect(данные.kind).toBe("hls");
    expect(данные.url).toContain("film.m3u8");
  });

  it("ролику с пациентом отдаётся цельный файл, а не HLS", async () => {
    // Сегменты HLS сейчас раздаются без подписи: ссылка на манифест
    // открыла бы их все. Для PHI это недопустимо.
    const хозяин = id();
    const video = await готовыйРолик({ ownerId: хозяин, phi: true });
    const данные = await getPlaybackUrls({ actor: актёр(хозяин), id: video._id });

    expect(данные.kind).toBe("file");
    expect(данные.url).toContain("film.mp4");
  });

  it("для ролика с пациентом срок ссылки короче", async () => {
    const хозяин = id();
    const обычный = await готовыйРолик({ ownerId: хозяин });
    const сPHI = await готовыйРолик({ ownerId: хозяин, phi: true });

    const а = await getPlaybackUrls({ actor: актёр(хозяин), id: обычный._id });
    const б = await getPlaybackUrls({ actor: актёр(хозяин), id: сPHI._id });

    expect(б.expiresInSec).toBeLessThan(а.expiresInSec);
    expect(б.expiresInSec).toBe(600);
  });

  it("сбой подписи одной дорожки субтитров не лишает ролика", async () => {
    const хозяин = id();
    const video = await готовыйРолик({
      ownerId: хозяин,
      locales: [
        { lang: "ru", subtitleKey: "subs/ru.vtt" },
        { lang: "en", subtitleKey: "subs/en.vtt" },
      ],
    });

    getSignedUrl.mockImplementation(async (_c, command, opts) => {
      const key = command?.input?.Key || "";
      if (key.endsWith("en.vtt")) throw new Error("подпись не вышла");
      return `https://signed.test/${key}?ttl=${opts?.expiresIn}`;
    });

    const данные = await getPlaybackUrls({ actor: актёр(хозяин), id: video._id });
    expect(данные.url).toBeTruthy();
    expect(данные.subtitles.map((s) => s.lang)).toEqual(["ru"]);
  });
});

describe("учёт просмотра", () => {
  it("девять десятых длительности считаются досмотром", async () => {
    const хозяин = id();
    const video = await готовыйРолик({ ownerId: хозяин });

    const итог = await recordWatch({
      actor: актёр(хозяин),
      id: video._id,
      watchedSec: 95,
    });

    expect(итог.completed).toBe(true);
    const свежий = await Video.findById(video._id);
    expect(свежий.stats.views).toBe(1);
    expect(свежий.stats.completions).toBe(1);
  });

  it("половина ролика досмотром не считается", async () => {
    const хозяин = id();
    const video = await готовыйРолик({ ownerId: хозяин });

    const итог = await recordWatch({
      actor: актёр(хозяин),
      id: video._id,
      watchedSec: 50,
    });

    expect(итог.completed).toBe(false);
    const свежий = await Video.findById(video._id);
    expect(свежий.stats.completions).toBe(0);
  });

  it("завышенное время обрезается по длительности ролика", async () => {
    // Число приходит от клиента: без обрезки один запрос накрутил бы
    // и статистику, и — в фазе 2 — доказательство просмотра согласия.
    const хозяин = id();
    const video = await готовыйРолик({ ownerId: хозяин });

    await recordWatch({ actor: актёр(хозяин), id: video._id, watchedSec: 99999 });

    const запись = await HIPAAAuditLog.findOne({ action: "video.watch" }).lean();
    expect(запись.metadata.watchedSec).toBe(100);
    expect(запись.metadata.ratio).toBe(1);
  });

  it("просмотр посторонним невозможен", async () => {
    const video = await готовыйРолик();
    await expect(
      recordWatch({ actor: актёр(id()), id: video._id, watchedSec: 10 }),
    ).rejects.toThrow(/не найдено/i);
  });

  it("просмотр попадает в журнал с глубиной, но без названия", async () => {
    const хозяин = id();
    const video = await готовыйРолик({ ownerId: хозяин, title: "Иванов, гастроскопия" });

    await recordWatch({ actor: актёр(хозяин), id: video._id, watchedSec: 40 });

    const запись = await HIPAAAuditLog.findOne({ action: "video.watch" }).lean();
    expect(запись).toBeTruthy();
    expect(запись.metadata.watchedSec).toBe(40);
    expect(запись.metadata.completed).toBe(false);
    expect(JSON.stringify(запись.metadata)).not.toMatch(/Иванов/);
  });
});
