// Вебхук студии: «фильм готов, вот файл».
//
// Это единственная дверь модуля, открытая без сессии, поэтому проверяем её
// с той же придирчивостью, что и пропуск в студию: чужая подпись, просрочка
// и подмена идентификатора фильма должны получать отказ, а честный вызов —
// проходить.
//
// Ключ читается при каждом вызове (как в pass.js), поэтому тест может
// подставить свой — без этого проверить подпись было бы нечем.

import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "node:crypto";

const КЛЮЧ = "ключ-для-теста-совсем-не-настоящий";

let проверитьПодписьСтудии, заголовкиВызова;

/** Ответ express, каким его видит middleware. */
function ответ() {
  const о = {
    код: null,
    тело: null,
    status(c) {
      о.код = c;
      return о;
    },
    json(b) {
      о.тело = b;
      return о;
    },
  };
  return о;
}

/** Запрос с заголовками — get() как у express. */
function запрос(заголовки, тело) {
  return {
    get: (имя) => заголовки[имя.toLowerCase()] || undefined,
    body: тело,
  };
}

beforeEach(async () => {
  process.env.DPVIDERA_SECRET = КЛЮЧ;
  vi.resetModules();
  ({ проверитьПодписьСтудии, заголовкиВызова } = await import(
    "../../modules/video/studioCallback.js"
  ));
});

describe("подпись вебхука студии", () => {
  it("честный вызов проходит", () => {
    const тело = { studioFilmId: "film-1", status: "ready" };
    const h = заголовкиВызова(тело);
    const req = запрос(
      {
        "x-videra-timestamp": h["x-videra-timestamp"],
        "x-videra-signature": h["x-videra-signature"],
      },
      тело,
    );
    const res = ответ();
    const next = vi.fn();

    проверитьПодписьСтудии(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.код).toBeNull();
  });

  it("подпись чужим ключом отклоняется", () => {
    const тело = { studioFilmId: "film-1", status: "ready" };
    const ts = String(Math.floor(Date.now() / 1000));
    const чужая = crypto
      .createHmac("sha256", "совсем-другой-ключ")
      .update(`${ts}.film-1.ready`)
      .digest("base64url");

    const res = ответ();
    const next = vi.fn();
    проверитьПодписьСтудии(
      запрос({ "x-videra-timestamp": ts, "x-videra-signature": чужая }, тело),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.код).toBe(401);
  });

  it("просроченный вызов отклоняется", () => {
    const тело = { studioFilmId: "film-1", status: "ready" };
    const старый = String(Math.floor(Date.now() / 1000) - 3600);
    const подпись = crypto
      .createHmac("sha256", КЛЮЧ)
      .update(`${старый}.film-1.ready`)
      .digest("base64url");

    const res = ответ();
    const next = vi.fn();
    проверитьПодписьСтудии(
      запрос({ "x-videra-timestamp": старый, "x-videra-signature": подпись }, тело),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.код).toBe(401);
  });

  it("подмена идентификатора фильма ломает подпись", () => {
    // Подпись выпущена для film-1, а в теле подставлен film-2 — ровно та
    // атака, ради которой идентификатор и входит в подписываемую строку.
    const h = заголовкиВызова({ studioFilmId: "film-1", status: "ready" });
    const res = ответ();
    const next = vi.fn();

    проверитьПодписьСтудии(
      запрос(
        {
          "x-videra-timestamp": h["x-videra-timestamp"],
          "x-videra-signature": h["x-videra-signature"],
        },
        { studioFilmId: "film-2", status: "ready" },
      ),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.код).toBe(401);
  });

  it("без заголовков — отказ, а не падение", () => {
    const res = ответ();
    const next = vi.fn();
    проверитьПодписьСтудии(запрос({}, { studioFilmId: "film-1" }), res, next);
    expect(res.код).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("без ключа в окружении дверь закрыта совсем", async () => {
    process.env.DPVIDERA_SECRET = "";
    vi.resetModules();
    const модуль = await import("../../modules/video/studioCallback.js");

    const res = ответ();
    const next = vi.fn();
    модуль.проверитьПодписьСтудии(запрос({}, {}), res, next);

    // 503, а не 401: студия не настроена — это состояние сервера, а не
    // подозрительный запрос, и различать их важно при разборе.
    expect(res.код).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });
});
