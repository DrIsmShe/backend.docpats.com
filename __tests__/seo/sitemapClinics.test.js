// Витрины клиник в карте сайта.
//
// Секция «clinics» дважды оказывалась пустой незаметно: пустые секции в
// индекс намеренно не пишутся (ссылка на файл с нулём URL — ошибка в Search
// Console), а fetchClinicUrls глотает исключение и возвращает пустой
// результат. В обоих случаях наружу это выглядит одинаково — файла просто
// нет, и отличить «клиник ещё не завели» от «выборка сломалась» по выдаче
// невозможно. Тест закрывает разницу: при опубликованной клинике секция
// обязана появиться.
//
// Адрес проверяется КОРНЕВОЙ. Витрина доступна и по /clinics/:slug, но
// канонический адрес — корневой, и звать бота картой сайта на второй
// адрес значит тратить обход на страницу, которую он отбросит.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import Clinic from "../../modules/clinic/clinic-core/models/clinic.model.js";
import {
  buildSitemapSet,
  invalidateSitemapCache,
} from "../../common/sitemap/services/sitemap.service.js";

const BASE = process.env.FRONTEND_URL || "http://localhost:3000";

async function makeClinic(overrides = {}) {
  return Clinic.create({
    name: "Тестовая клиника",
    slug: "testovaya-klinika",
    ownerId: new mongoose.Types.ObjectId(),
    isPublished: true,
    isActive: true,
    ...overrides,
  });
}

describe("sitemap: витрины клиник", () => {
  beforeEach(() => invalidateSitemapCache());

  it("опубликованная клиника попадает в секцию clinics", async () => {
    await makeClinic();

    const { files } = await buildSitemapSet();

    expect(files.has("clinics")).toBe(true);
    expect(files.get("clinics")).toContain(`<loc>${BASE}/testovaya-klinika</loc>`);
  });

  it("адрес корневой, а не /clinics/<slug>", async () => {
    await makeClinic();

    const { files } = await buildSitemapSet();

    expect(files.get("clinics")).not.toContain("/clinics/testovaya-klinika");
  });

  it("неопубликованная клиника секцию не создаёт", async () => {
    await makeClinic({ isPublished: false });

    const { index, files } = await buildSitemapSet();

    expect(files.has("clinics")).toBe(false);
    expect(index).not.toContain("sitemap-clinics.xml");
  });

  it("скрытая клиника не попадает, даже если рядом есть опубликованная", async () => {
    await makeClinic();
    await makeClinic({ slug: "skrytaya-klinika", isPublished: false });

    const { files } = await buildSitemapSet();

    expect(files.get("clinics")).toContain("testovaya-klinika");
    expect(files.get("clinics")).not.toContain("skrytaya-klinika");
  });
});
