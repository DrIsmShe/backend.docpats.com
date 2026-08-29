// __tests__/jobs/conferenceDigest.test.js
//
// Подборка конференций: кому шлём, в каком порядке и что попадает в письмо.
//
// Проверяем ровно те решения, которые легко откатить назад по невнимательности:
//   - пустой список интересов означает «всё», а не «ничего»;
//   - конференция без категорий (ИИ в медицине, право) доходит до всех;
//   - своя страна идёт выше далёкой очной;
//   - в письме есть даты и дедлайн, а не одна интрига со ссылкой.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  matchesDoctor,
  rankForDoctor,
  buildDigestEmail,
  selectConferenceRecipients,
} from "../../jobs/conferenceDigest.job.js";
import {
  createUnsubscribeToken,
  verifyUnsubscribeToken,
} from "../../common/services/unsubscribeToken.js";
import { createTestDoctor } from "../helpers/createTestUser.js";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date();

let savedBrevo;
beforeAll(() => {
  // Гарантируем, что реальные письма НЕ уходят.
  savedBrevo = process.env.BREVO_API_KEY;
  process.env.BREVO_API_KEY = "";
  process.env.SECRET = process.env.SECRET || "test-secret";
});
afterAll(() => {
  process.env.BREVO_API_KEY = savedBrevo;
});

const conf = (over = {}) => ({
  title: "Congress",
  slug: "congress",
  startDate: new Date(now.getTime() + 30 * DAY),
  format: "onsite",
  categories: [],
  ...over,
});

describe("matchesDoctor — кому какая конференция", () => {
  it("врач без выбранных категорий получает всё", () => {
    expect(matchesDoctor(conf({ categories: ["oncology"] }), { categories: [] })).toBe(true);
  });

  it("конференция вне специальностей доходит до всех", () => {
    // ИИ в медицине, право, управление клиникой — categories пуст, и это
    // не «неразмеченная», а «нужна всем».
    expect(matchesDoctor(conf({ categories: [] }), { categories: ["dentistry"] })).toBe(true);
  });

  it("несовпадение категорий отсекает", () => {
    expect(
      matchesDoctor(conf({ categories: ["oncology"] }), { categories: ["dentistry"] }),
    ).toBe(false);
  });

  it("достаточно одного пересечения — кардиоонколог получает обе темы", () => {
    expect(
      matchesDoctor(conf({ categories: ["oncology"] }), {
        categories: ["therapeutic", "oncology"],
      }),
    ).toBe(true);
  });
});

describe("rankForDoctor — география важнее темы", () => {
  const items = [
    conf({ title: "Chicago", slug: "chi", country: "US", registrationDeadline: new Date(now.getTime() + 5 * DAY) }),
    conf({ title: "Baku", slug: "baku", country: "AZ", registrationDeadline: new Date(now.getTime() + 20 * DAY) }),
    conf({ title: "Online", slug: "onl", format: "online", registrationDeadline: new Date(now.getTime() + 10 * DAY) }),
  ];

  it("своя страна выше онлайна, онлайн выше далёкой очной", () => {
    expect(rankForDoctor(items, { country: "AZ" }).map((c) => c.title)).toEqual([
      "Baku",
      "Online",
      "Chicago",
    ]);
  });

  it("страна регистра не различает", () => {
    expect(rankForDoctor(items, { country: "az" })[0].title).toBe("Baku");
  });

  it("без страны врача порядок задаёт дедлайн", () => {
    expect(rankForDoctor(items, {}).map((c) => c.title)).toEqual([
      "Online",
      "Chicago",
      "Baku",
    ]);
  });
});

describe("buildDigestEmail — что видно прямо в письме", () => {
  const items = [
    conf({
      title: "European Congress of Cardiology",
      slug: "ecc-2026",
      city: "Vienna",
      country: "AT",
      startDate: new Date("2026-11-01T00:00:00Z"),
      endDate: new Date("2026-11-04T00:00:00Z"),
      registrationDeadline: new Date("2026-10-01T00:00:00Z"),
    }),
  ];

  it("даты и дедлайн есть в тексте, а не спрятаны за ссылкой", () => {
    // Приём с интригой поднимает открытия на первых письмах и роняет
    // доверие на третьем: врач должен решать «моё / не моё» из письма.
    const { body } = buildDigestEmail({ lang: "ru", firstName: "Иван", items });
    expect(body).toContain("European Congress of Cardiology");
    expect(body).toContain("2026");
    expect(body).toContain("регистрация до");
    expect(body).toContain("Vienna");
  });

  it("ссылка ведёт на карточку, а не в общий список", () => {
    const { body } = buildDigestEmail({ lang: "ru", items });
    expect(body).toContain("/conferences/ecc-2026");
  });

  it("тема письма переводится, неизвестный язык падает на русский", () => {
    expect(buildDigestEmail({ lang: "en", items }).subject).toMatch(/Upcoming conferences/);
    expect(buildDigestEmail({ lang: "zz", items }).subject).toMatch(/Предстоящие конференции/);
  });

  it("онлайн-конференция не печатает пустое место", () => {
    const { body } = buildDigestEmail({
      lang: "ru",
      items: [conf({ format: "online", city: "", country: "" })],
    });
    expect(body).toContain("онлайн");
    expect(body).not.toMatch(/·\s*·/);
  });
});

describe("selectConferenceRecipients — анти-спам", () => {
  it("берёт врача без отправок и пропускает отписавшегося и свежеотправленного", async () => {
    const fresh = await createTestDoctor({});
    const optedOut = await createTestDoctor({ conferenceDigestEnabled: false });
    const recent = await createTestDoctor({
      lastConferenceEmailAt: new Date(now.getTime() - 2 * DAY),
    });

    const ids = (await selectConferenceRecipients(now)).map((r) => String(r.user._id));

    expect(ids).toContain(String(fresh.userId));
    expect(ids).not.toContain(String(optedOut.userId));
    expect(ids).not.toContain(String(recent.userId));
  });

  it("врач, которому слали давно, снова попадает в выборку", async () => {
    const old = await createTestDoctor({
      lastConferenceEmailAt: new Date(now.getTime() - 30 * DAY),
    });
    const ids = (await selectConferenceRecipients(now)).map((r) => String(r.user._id));
    expect(ids).toContain(String(old.userId));
  });

  it("пациентам подборка не уходит", async () => {
    const p = await createTestDoctor({ role: "patient", isDoctor: false, isPatient: true });
    const ids = (await selectConferenceRecipients(now)).map((r) => String(r.user._id));
    expect(ids).not.toContain(String(p.userId));
  });
});

describe("токен отписки", () => {
  it("подписанный токен читается обратно", () => {
    const t = createUnsubscribeToken("507f1f77bcf86cd799439011", "conference");
    expect(verifyUnsubscribeToken(t)).toEqual({
      userId: "507f1f77bcf86cd799439011",
      list: "conference",
    });
  });

  it("подделанная подпись не проходит", () => {
    const t = createUnsubscribeToken("507f1f77bcf86cd799439011", "conference");
    expect(verifyUnsubscribeToken(`${t.slice(0, -2)}xx`)).toBeNull();
  });

  it("протухший токен не проходит", () => {
    expect(verifyUnsubscribeToken(createUnsubscribeToken("u", "conference", -1))).toBeNull();
  });

  it("мусор вместо токена не роняет проверку", () => {
    expect(verifyUnsubscribeToken("garbage")).toBeNull();
    expect(verifyUnsubscribeToken("")).toBeNull();
    expect(verifyUnsubscribeToken(undefined)).toBeNull();
  });

  it("токен помнит, ОТ КАКОЙ рассылки отписывают", () => {
    // Отписка от конференций не должна выключать письма о приёмах.
    expect(verifyUnsubscribeToken(createUnsubscribeToken("u1", "digest")).list).toBe("digest");
  });
});
