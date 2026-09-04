// Пропуск в студию фильмов DP-Videra.
//
// Проверяем ровно то, на что полагается вторая сторона: студия принимает
// пропуск, только если подпись сошлась и срок не вышел. Ошибка здесь —
// это либо чужой человек внутри, либо свой снаружи.
//
// Модуль читает ключ из окружения при КАЖДОМ вызове, а не при загрузке:
// иначе тест не смог бы подставить свой, а на сервере ключ, дописанный в
// .env, требовал бы перезапуска ради самого факта чтения.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";

const КЛЮЧ = "клюю-для-теста-совсем-не-настоящий";

let собратьПропуск, ссылкаНаСтудию, студияВключена;

/** Разбор пропуска глазами студии: та же проверка, что на другой стороне. */
function проверить(пропуск, ключ = КЛЮЧ) {
  const точка = пропуск.lastIndexOf(".");
  if (точка < 0) return null;
  const тело = пропуск.slice(0, точка);
  const подпись = пропуск.slice(точка + 1);

  const ждём = crypto.createHmac("sha256", ключ).update(тело).digest("base64url");
  const а = Buffer.from(подпись);
  const б = Buffer.from(ждём);
  if (а.length !== б.length || !crypto.timingSafeEqual(а, б)) return null;

  const данные = JSON.parse(Buffer.from(тело, "base64url").toString("utf8"));
  if (данные["до"] < Math.floor(Date.now() / 1000)) return null;
  return данные;
}

beforeEach(async () => {
  process.env.DPVIDERA_SECRET = КЛЮЧ;
  process.env.DPVIDERA_URL = "https://docpats.com/dp-videra";
  ({ собратьПропуск, ссылкаНаСтудию, студияВключена } = await import(
    "../../modules/videra/pass.js"
  ));
});

afterEach(() => {
  delete process.env.DPVIDERA_SECRET;
  delete process.env.DPVIDERA_URL;
});

describe("пропуск в студию фильмов", () => {
  it("студия проверяет подпись и читает, кто пришёл", () => {
    const п = собратьПропуск({
      id: "665f00000000000000000001",
      name: "Иванов Пётр",
      clinic: "Клиника на Садовой",
      plan: "doctor_super",
    });

    const кто = проверить(п);
    expect(кто).not.toBeNull();
    expect(кто.id).toBe("665f00000000000000000001");
    expect(кто.name).toBe("Иванов Пётр");
    expect(кто.clinic).toBe("Клиника на Садовой");
    expect(кто.plan).toBe("doctor_super");
  });

  it("чужим ключом не открывается", () => {
    const п = собратьПропуск({ id: "1" });
    expect(проверить(п, "другой-ключ")).toBeNull();
  });

  it("подделанное тело не проходит", () => {
    const п = собратьПропуск({ id: "1", plan: "doctor_free" });
    const [тело, подпись] = п.split(".");
    const своё = JSON.parse(Buffer.from(тело, "base64url").toString("utf8"));
    своё.plan = "clinic"; // сам себе снял водяной знак
    const подделка =
      Buffer.from(JSON.stringify(своё), "utf8").toString("base64url") + "." + подпись;

    expect(проверить(подделка)).toBeNull();
  });

  it("через пять минут уже не открывает", () => {
    // Отрицательный срок — тот же просроченный пропуск, но без ожидания.
    const п = собратьПропуск({ id: "1" }, -1);
    expect(проверить(п)).toBeNull();
  });

  it("без «кто это» пропуск не собирается", () => {
    expect(() => собратьПропуск({})).toThrow();
    expect(() => собратьПропуск(null)).toThrow();
  });

  it("без ключа студия выключена и пропуск не выдаётся", async () => {
    delete process.env.DPVIDERA_SECRET;
    expect(студияВключена()).toBe(false);
    expect(() => собратьПропуск({ id: "1" })).toThrow(/DPVIDERA_SECRET/);
  });

  it("ссылка ведёт на вход студии и несёт пропуск", () => {
    const адрес = ссылкаНаСтудию({ id: "1", name: "Пётр" });
    const у = new URL(адрес);

    expect(у.origin + у.pathname).toBe("https://docpats.com/dp-videra/enter");
    expect(проверить(у.searchParams.get("token")).name).toBe("Пётр");
  });

  it("имя с косой чертой и знаком вопроса переживает ссылку", () => {
    // Пропуск едет в строке запроса: неэкранированный «&» отрезал бы
    // половину подписи, и вход молча перестал бы работать у одного врача.
    const хитрое = "О'Брайен & Ко / ?тест=1";
    const адрес = ссылкаНаСтудию({ id: "1", name: хитрое });

    expect(проверить(new URL(адрес).searchParams.get("token")).name).toBe(хитрое);
  });
});
