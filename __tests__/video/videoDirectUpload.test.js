// Запасной путь загрузки — через сервер.
//
// Нужен, пока хранилище не разрешает браузеру писать напрямую. Проверяем
// две вещи: что он не стал лазейкой мимо правил, и что он не отказывает
// человеку, который эти правила принял, — ровно это и случилось, когда
// проверке согласия передали строку вместо объекта.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";

import { directUpload } from "../../modules/video/services/videoDirectUpload.service.js";
import { ВЕРСИЯ_ПРАВИЛ, правилаПриняты } from "../../modules/video/uploadRules.js";

const id = () => new mongoose.Types.ObjectId();

function автор() {
  return { ownerType: "user", ownerId: id(), clinicId: null, role: null, email: null };
}

/** Минимальный «файл» в том виде, в каком его отдаёт multer. */
function файл(поля = {}) {
  return {
    buffer: Buffer.alloc(1024, 1),
    mimetype: "video/mp4",
    originalname: "рассказ.mp4",
    ...поля,
  };
}

function данные(поля = {}) {
  return {
    title: "Как готовиться к МРТ",
    durationSec: 60,
    termsAccepted: "true",
    rulesVersion: ВЕРСИЯ_ПРАВИЛ,
    ...поля,
  };
}

describe("загрузка через сервер: правила", () => {
  it("без согласия отказывает", async () => {
    await expect(
      directUpload({
        actor: автор(),
        file: файл(),
        data: данные({ termsAccepted: "false" }),
      }),
    ).rejects.toThrow(/правила/i);
  });

  it("со старой редакцией правил отказывает", async () => {
    // Согласие на прошлую редакцию не годится: человек соглашался с
    // другим текстом.
    await expect(
      directUpload({
        actor: автор(),
        file: файл(),
        data: данные({ rulesVersion: "2020-01-01" }),
      }),
    ).rejects.toThrow(/правила/i);
  });

  it("принятые правила проходят проверку", () => {
    // Проверяем САМ КОНТРАКТ, а не весь путь загрузки: успешный
    // directUpload дошёл бы до хранилища и записал туда файл — тесты
    // не должны сорить в боевом бакете.
    //
    // Ошибка была именно в форме аргумента: проверке передавали
    // строку с версией вместо объекта с согласием и версией.
    expect(
      правилаПриняты({ termsAccepted: true, termsVersion: ВЕРСИЯ_ПРАВИЛ }),
    ).toBe(true);

    expect(правилаПриняты(ВЕРСИЯ_ПРАВИЛ)).toBe(false);
    expect(правилаПриняты({ termsVersion: ВЕРСИЯ_ПРАВИЛ })).toBe(false);
  });
});

describe("загрузка через сервер: пределы", () => {
  it("чужой формат не принимается", async () => {
    await expect(
      directUpload({
        actor: автор(),
        file: файл({ mimetype: "application/pdf" }),
        data: данные(),
      }),
    ).rejects.toThrow(/формат/i);
  });

  it("ролик длиннее предела не принимается", async () => {
    await expect(
      directUpload({
        actor: автор(),
        file: файл(),
        data: данные({ durationSec: 60 * 60 }),
      }),
    ).rejects.toThrow(/минут/i);
  });

  it("пустой файл не принимается", async () => {
    await expect(
      directUpload({
        actor: автор(),
        file: { buffer: Buffer.alloc(0), mimetype: "video/mp4" },
        data: данные(),
      }),
    ).rejects.toThrow(/файл/i);
  });
});
