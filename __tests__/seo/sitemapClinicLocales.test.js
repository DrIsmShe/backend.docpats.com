// Языковые адреса витрины клиники в карте сайта.
//
// Витрина — единственная публичная поверхность с настоящими языковыми
// версиями: сервер отдаёт описание и слоган переведёнными по ?locale=.
// До этого карта сайта звала бота на один голый адрес, и переводы, которые
// в базе есть, для поиска не существовали.
//
// Проверяется главным образом ОДНА вещь, на которой это ломается тихо:
// какой адрес считается голым. Сервер отдаёт по адресу без ?locale= язык
// ОРИГИНАЛА клиники (clinic-public.mapper.js), а clinicLanguages() возвращает
// языки в фиксированном порядке ru, en, az, tr, ar. Взять первый элемент за
// оригинал — значит для клиники с оригиналом az и переводом на ru объявить
// русской ту страницу, где отдаётся азербайджанский. Ровно так и вёл себя
// netlify/edge-functions/seo.js.

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

async function clinicSection() {
  const { files } = await buildSitemapSet();
  return files.get("clinics") || "";
}

describe("sitemap: языковые версии витрины", () => {
  beforeEach(() => invalidateSitemapCache());

  it("клиника без переводов остаётся одной записью без hreflang", async () => {
    await makeClinic({ originalLanguage: "ru" });

    const xml = await clinicSection();

    expect(xml).toContain(`<loc>${BASE}/testovaya-klinika</loc>`);
    // Один текст, связанный сам с собой пятью ссылками, — не языковая
    // разметка, а её видимость.
    expect(xml).not.toContain("hreflang");
    expect(xml).not.toContain("?locale=");
  });

  it("переведённая клиника даёт адрес на каждый ПЕРЕВЕДЁННЫЙ язык", async () => {
    await makeClinic({
      originalLanguage: "ru",
      descriptionI18n: { en: "English description", az: "Azərbaycan təsviri" },
    });

    const xml = await clinicSection();

    expect(xml).toContain(`<loc>${BASE}/testovaya-klinika</loc>`);
    expect(xml).toContain(`<loc>${BASE}/testovaya-klinika?locale=en</loc>`);
    expect(xml).toContain(`<loc>${BASE}/testovaya-klinika?locale=az</loc>`);
    // Турецкого и арабского перевода нет — и адресов быть не должно.
    expect(xml).not.toContain("?locale=tr");
    expect(xml).not.toContain("?locale=ar");
  });

  it("голый адрес — это ОРИГИНАЛ клиники, а не первый язык в списке", async () => {
    // Оригинал az, перевод на ru. clinicLanguages() вернёт ["ru", "az"] —
    // фиксированный порядок, — и наивное languages[0] дало бы ru.
    await makeClinic({
      originalLanguage: "az",
      descriptionI18n: { ru: "Русское описание" },
    });

    const xml = await clinicSection();

    // Азербайджанская версия живёт на голом адресе…
    expect(xml).toContain(
      `<xhtml:link rel="alternate" hreflang="az" href="${BASE}/testovaya-klinika"/>`,
    );
    // …а русская получает собственный адрес.
    expect(xml).toContain(
      `<xhtml:link rel="alternate" hreflang="ru" href="${BASE}/testovaya-klinika?locale=ru"/>`,
    );
    expect(xml).not.toContain("?locale=az");
  });

  it("каждая версия перечисляет все языки плюс x-default", async () => {
    await makeClinic({
      originalLanguage: "ru",
      sloganI18n: { tr: "Türkçe slogan" },
    });

    const xml = await clinicSection();

    // Протокол требует, чтобы КАЖДАЯ версия перечисляла все, включая себя:
    // односторонняя ссылка hreflang не связывает версии.
    const blocks = xml.split("<url>").filter((b) => b.includes("<loc>"));
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(block).toContain('hreflang="x-default"');
      expect(block).toContain('hreflang="ru"');
      expect(block).toContain('hreflang="tr"');
    }
  });

  it("x-default ведёт на оригинал", async () => {
    await makeClinic({
      originalLanguage: "en",
      descriptionI18n: { ru: "Русское описание" },
    });

    const xml = await clinicSection();

    // Посетитель, язык которого неизвестен, должен попасть на оригинал —
    // это единственная версия, про которую точно известно, что она полная.
    expect(xml).toContain(
      `<xhtml:link rel="alternate" hreflang="x-default" href="${BASE}/testovaya-klinika"/>`,
    );
  });

  it("адреса всех версий различны — в этом и смысл hreflang", async () => {
    await makeClinic({
      originalLanguage: "ru",
      descriptionI18n: { en: "En", az: "Az", tr: "Tr", ar: "Ar" },
    });

    const xml = await clinicSection();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

    expect(locs).toHaveLength(5);
    expect(new Set(locs).size).toBe(5);
  });
});
