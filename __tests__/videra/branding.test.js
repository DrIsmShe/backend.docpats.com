// Чей знак стоит на фильме DP-Videra.
//
// Это не косметика, а ступень продажи: снятие чужой марки и свой логотип —
// то, за что платят клинические тарифы. Ошибка в одну сторону отдаёт
// платное даром, в другую — ставит чужой знак тому, кто за его отсутствие
// заплатил. Обе видны не сразу: фильм уже разошёлся.
//
// Решение принимает ПЛАТФОРМА и присылает готовым в пропуске: тариф
// известен здесь, а список тарифов в двух репозиториях однажды разошёлся бы
// молча.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";

import { videraBrandingMode } from "../../common/config/aiPlanLimits.js";

const КЛЮЧ = "клюю-для-теста-совсем-не-настоящий";

let собратьПропуск;

/** Разбор пропуска глазами студии. */
function разобрать(пропуск) {
  const точка = пропуск.lastIndexOf(".");
  const тело = пропуск.slice(0, точка);
  const подпись = пропуск.slice(точка + 1);
  const ждём = crypto.createHmac("sha256", КЛЮЧ).update(тело).digest("base64url");
  if (подпись !== ждём) return null;
  return JSON.parse(Buffer.from(тело, "base64url").toString("utf8"));
}

beforeEach(async () => {
  process.env.DPVIDERA_SECRET = КЛЮЧ;
  const mod = await import("../../modules/videra/pass.js");
  собратьПропуск = mod.собратьПропуск || mod.buildPass;
});

afterEach(() => {
  delete process.env.DPVIDERA_SECRET;
});

describe("чей знак на фильме", () => {
  it("бесплатный и дешёвые тарифы остаются с нашим знаком", () => {
    // Фильм уходит от автора: его показывают, пересылают, выкладывают.
    // Метка в углу — единственная бесплатная реклама студии, и отдавать
    // её даром не за что.
    expect(videraBrandingMode("doctor_free")).toBe("ours");
    expect(videraBrandingMode("doctor_lite")).toBe("ours");
    expect(videraBrandingMode("doctor_super")).toBe("ours");
  });

  it("дорогой врачебный и начальный клинический снимают знак совсем", () => {
    expect(videraBrandingMode("doctor_pro")).toBe("none");
    expect(videraBrandingMode("clinic_start")).toBe("none");
  });

  it("свой логотип — только клиникам: он есть у клиники, а не у врача", () => {
    expect(videraBrandingMode("clinic")).toBe("own");
    expect(videraBrandingMode("clinic_pro")).toBe("own");
  });

  it("незнакомый тариф трактуется в нашу пользу, а не в чужую", () => {
    // Новый тариф, забытый в этом списке, не должен молча раздавать
    // white label: неизвестность стоит трактовать как «платил меньше».
    expect(videraBrandingMode("совсем-новый-тариф")).toBe("ours");
    expect(videraBrandingMode(undefined)).toBe("ours");
  });
});

describe("пропуск доносит решение до студии", () => {
  it("несёт режим знака и ссылку на логотип", () => {
    const пропуск = собратьПропуск({
      id: "1",
      name: "Врач",
      clinic: "Клиника",
      plan: "clinic",
      badge: "own",
      logo: "https://example.test/logo.png",
    });

    const тело = разобрать(пропуск);
    expect(тело.badge).toBe("own");
    expect(тело.logo).toBe("https://example.test/logo.png");
  });

  it("без полей знака пропуск остаётся с нашей меткой", () => {
    // Старый вызов, не знающий про знак, не должен случайно выдать
    // white label.
    const тело = разобрать(собратьПропуск({ id: "1", name: "Врач", plan: "doctor_free" }));
    expect(тело.badge).toBe("ours");
    expect(тело.logo).toBe("");
  });
});
