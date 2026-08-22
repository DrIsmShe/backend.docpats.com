// Языковая разметка sitemap.
//
// Проверяем ровно то, что было сломано: hreflang, указывающий на один и
// тот же адрес для всех пяти языков, ничего не сообщает поисковику — он
// не может проиндексировать пять версий одного URL. Разметка обязана
// вести на РАЗНЫЕ адреса, а там, где разных адресов не существует, её не
// должно быть вовсе.

import { describe, it, expect } from "vitest";
import {
  urlEntry,
  urlEntriesForLocalizedNews,
} from "../../common/sitemap/services/sitemap.service.js";

const BASE = "https://docpats.com/news/some-slug";

function locsOf(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

function hreflangsOf(xmlBlock) {
  return [...xmlBlock.matchAll(/hreflang="([^"]+)"\s+href="([^"]+)"/g)].map(
    (m) => ({ lang: m[1], href: m[2] }),
  );
}

describe("sitemap: страницы без языкового адреса", () => {
  it("не выписывают hreflang вообще", () => {
    const xml = urlEntry({
      loc: "https://docpats.com/public/doctor-profile/doctor-details/abc",
      lastmod: "2026-08-22",
      changefreq: "weekly",
      priority: "0.8",
    });

    expect(xml).not.toContain("hreflang");
    expect(locsOf(xml)).toHaveLength(1);
  });
});

describe("sitemap: новости с языковыми адресами", () => {
  const xml = urlEntriesForLocalizedNews({ baseUrl: BASE, lastmod: "2026-08-22" });
  const locs = locsOf(xml);

  it("даёт по одной записи на язык", () => {
    expect(locs).toHaveLength(5);
  });

  it("английская версия живёт на голом адресе, без ?locale=en", () => {
    expect(locs).toContain(BASE);
    expect(xml).not.toContain("locale=en");
  });

  it("остальные языки — на своих адресах", () => {
    for (const lang of ["ru", "az", "tr", "ar"]) {
      expect(locs).toContain(`${BASE}?locale=${lang}`);
    }
  });

  it("все адреса различны — это и есть суть hreflang", () => {
    expect(new Set(locs).size).toBe(locs.length);
  });

  it("каждая версия перечисляет все языки плюс x-default", () => {
    const blocks = xml.match(/<url>[\s\S]*?<\/url>/g);
    expect(blocks).toHaveLength(5);

    for (const block of blocks) {
      const links = hreflangsOf(block);
      expect(links.map((l) => l.lang).sort()).toEqual(
        ["ar", "az", "en", "ru", "tr", "x-default"].sort(),
      );

      // Ссылки внутри блока обязаны вести на разные адреса: en и
      // x-default совпадают намеренно, остальные — нет.
      const hrefs = links.map((l) => l.href);
      expect(new Set(hrefs).size).toBe(5);

      expect(links.find((l) => l.lang === "x-default").href).toBe(BASE);
      expect(links.find((l) => l.lang === "en").href).toBe(BASE);
    }
  });
});
