// __tests__/userSynthesis/guestQuota.test.js
//
// Бесплатные попытки для невошедших посетителей.
//
// Повод конкретный: в интерфейсе страница показывала «использовано 0 из 1», а
// проверка лимита для гостя возвращала «можно» захардкоженно, без всякого
// хранилища. Счётчик был надписью, а эндпоинт генерации, открытый всему
// интернету, тратил деньги без потолка — с того же баланса, которым живут
// надиктовка у врача и ночная генерация кейсов.
//
// Здесь проверяется, что счётчик стал настоящим: считает, не пускает сверх
// лимита, различает посетителей и держит общий потолок на всех.

import { describe, it, expect, beforeEach } from "vitest";

import GuestUsage from "../../common/models/system/GuestUsage.js";
import {
  consumeGuestQuota,
  peekGuestQuota,
} from "../../common/services/guestQuota.service.js";

/** Минимальная подделка запроса: сервису нужен только адрес. */
const reqFrom = (ip) => ({ ip });

beforeEach(async () => {
  await GuestUsage.deleteMany({});
});

describe("бесплатные попытки гостя", () => {
  it("первая попытка разрешена и записана", async () => {
    const res = await consumeGuestQuota({
      req: reqFrom("1.2.3.4"),
      feature: "aiArticles",
      limit: 1,
    });

    expect(res.allowed).toBe(true);
    expect(res.used).toBe(1);
    expect(res.remaining).toBe(0);
    expect(await GuestUsage.countDocuments()).toBe(1);
  });

  it("вторая попытка того же посетителя отклоняется", async () => {
    const args = { req: reqFrom("1.2.3.4"), feature: "aiArticles", limit: 1 };
    await consumeGuestQuota(args);

    const res = await consumeGuestQuota(args);

    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("personal");
  });

  it("разные посетители считаются раздельно", async () => {
    const a = await consumeGuestQuota({
      req: reqFrom("1.1.1.1"),
      feature: "aiArticles",
      limit: 1,
    });
    const b = await consumeGuestQuota({
      req: reqFrom("2.2.2.2"),
      feature: "aiArticles",
      limit: 1,
    });

    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
  });

  it("адрес посетителя не хранится в открытом виде", async () => {
    // IP — персональные данные, и класть его рядом с медицинским содержимым
    // незачем: сравнивать хватает отпечатка.
    await consumeGuestQuota({
      req: reqFrom("203.0.113.77"),
      feature: "aiArticles",
      limit: 1,
    });

    const doc = await GuestUsage.findOne({}).lean();
    expect(doc.keyHash).not.toContain("203.0.113.77");
    expect(doc.keyHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("общий суточный потолок держит толпу с разных адресов", async () => {
    // Личный потолок не защищает от десятка адресов, а расход идёт с общего
    // баланса платформы.
    const args = { feature: "aiArticles", limit: 5, globalDaily: 3 };

    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(
        await consumeGuestQuota({ ...args, req: reqFrom(`10.0.0.${i}`) }),
      );
    }

    expect(results.filter((r) => r.allowed)).toHaveLength(3);
    expect(results[3].reason).toBe("global");
  });

  it("разные возможности не мешают друг другу", async () => {
    const req = reqFrom("1.2.3.4");
    await consumeGuestQuota({ req, feature: "aiArticles", limit: 1 });

    const other = await consumeGuestQuota({
      req,
      feature: "aiConsultations",
      limit: 1,
    });

    expect(other.allowed).toBe(true);
  });

  it("нулевой лимит закрывает возможность и не ходит в базу", async () => {
    const res = await consumeGuestQuota({
      req: reqFrom("1.2.3.4"),
      feature: "documentExports",
      limit: 0,
    });

    expect(res.allowed).toBe(false);
    expect(await GuestUsage.countDocuments()).toBe(0);
  });

  it("просмотр счётчика не расходует попытку", async () => {
    // Страница спрашивает лимит при каждом открытии: если бы просмотр списывал,
    // бесплатная попытка сгорала бы до того, как посетитель что-то нажал.
    const req = reqFrom("1.2.3.4");

    const peek = await peekGuestQuota({ req, feature: "aiArticles", limit: 1 });

    expect(peek.used).toBe(0);
    expect(peek.allowed).toBe(true);
    expect(await GuestUsage.countDocuments()).toBe(0);
  });

  it("после расхода просмотр показывает исчерпание", async () => {
    const req = reqFrom("1.2.3.4");
    await consumeGuestQuota({ req, feature: "aiArticles", limit: 1 });

    const peek = await peekGuestQuota({ req, feature: "aiArticles", limit: 1 });

    expect(peek.used).toBe(1);
    expect(peek.allowed).toBe(false);
  });

  it("одновременные запросы не проскакивают вдвоём", async () => {
    // Ради этого списание атомарное и идёт ДО обращения к модели: проверка
    // «посмотреть, потом списать» пропустила бы оба запроса при лимите в один.
    const args = { req: reqFrom("1.2.3.4"), feature: "aiArticles", limit: 1 };

    const results = await Promise.all([
      consumeGuestQuota(args),
      consumeGuestQuota(args),
    ]);

    expect(results.filter((r) => r.allowed)).toHaveLength(1);
  });
});
