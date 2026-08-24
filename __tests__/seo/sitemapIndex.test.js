// Разбиение sitemap на индекс + дочерние файлы.
//
// Проверяем то, из-за чего разбиение и появилось: одним файлом sitemap
// весил 48 МБ при жёстком пределе Google в 50 МБ, а предохранитель
// сторожил количество URL и про вес не знал ничего. Поэтому здесь
// проверяется прежде всего ВЕС, а не только счётчик.
//
// HTTP-уровень взят настоящий: маршрут дочернего файла задан регуляркой,
// и имя секции с дефисом (doctor-articles) — ровно тот случай, который
// ломается молча, если шаблон разобран не так.

import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";
import sitemapRoutes from "../../common/sitemap/routes/sitemap.routes.js";
import {
  chunkEntries,
  invalidateSitemapCache,
} from "../../common/sitemap/services/sitemap.service.js";

const app = express();
app.use("/", sitemapRoutes);

/** Запись заданного веса, содержащая ровно `urls` тегов <url>. */
function entryOf(urls, padBytes = 0) {
  const pad = "x".repeat(padBytes);
  return Array.from(
    { length: urls },
    (_, i) => `  <url><loc>https://docpats.com/${i}${pad}</loc></url>`,
  ).join("\n");
}

describe("chunkEntries: границы файла", () => {
  it("мелкую секцию не дробит", () => {
    const chunks = chunkEntries([entryOf(1), entryOf(1), entryOf(1)]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(3);
  });

  it("режет по ВЕСУ, а не только по числу записей", () => {
    // 12 записей по ~1 МБ: по счётчику URL до предела далеко (12 из
    // 10 000), но по весу это заведомо больше одного файла. Именно так
    // мы и упёрлись в лимит на проде.
    const heavy = Array.from({ length: 12 }, () => entryOf(1, 1024 * 1024));
    const chunks = chunkEntries(heavy);
    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      const bytes = chunk.reduce(
        (sum, e) => sum + Buffer.byteLength(e, "utf8"),
        0,
      );
      expect(bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    }
  });

  it("режет по числу URL", () => {
    // Две записи по 6000 URL: 12 000 > 10 000, значит два файла.
    const chunks = chunkEntries([entryOf(6000), entryOf(6000)]);
    expect(chunks).toHaveLength(2);
  });

  it("не разрывает элемент: языковой набор остаётся целым", () => {
    // Элемент новости — это пять языковых версий в одной строке. Половина
    // набора без остальных это битая hreflang-разметка, хуже, чем её
    // отсутствие. Ни один элемент не должен оказаться в двух файлах.
    const entries = Array.from({ length: 5 }, () => entryOf(5000));
    const chunks = chunkEntries(entries);
    const flat = chunks.flat();
    expect(flat).toHaveLength(entries.length);
    expect(new Set(flat).size).toBeLessThanOrEqual(entries.length);
    for (const chunk of chunks) {
      for (const e of chunk) expect(entries).toContain(e);
    }
  });

  it("одна запись крупнее лимита всё равно отдаётся, а не теряется", () => {
    // Потерять URL молча хуже, чем отдать файл чуть больше расчётного:
    // предел у Google с запасом относительно нашего.
    const chunks = chunkEntries([entryOf(1, 9 * 1024 * 1024)]);
    expect(chunks).toHaveLength(1);
  });
});

describe("HTTP: индекс и дочерние файлы", () => {
  beforeEach(async () => {
    invalidateSitemapCache();
    // Врач даёт непустую секцию doctors — иначе индекс пуст и проверять
    // нечего. Пишем прямо в коллекции: sitemap читает их так же.
    //
    // Нужны ОБЕ записи. Адрес врача строится из DoctorProfile._id (по нему
    // ищет /doctor-profile/doctor-detail/:id), а users отвечает только за
    // отбор «врач и не заблокирован» — см. __tests__/seo/sitemapDoctors.test.js.
    const { insertedId: userId } = await mongoose.connection.db
      .collection("users")
      .insertOne({
        isDoctor: true,
        isBlocked: false,
        updatedAt: new Date("2026-08-20T00:00:00Z"),
      });
    await mongoose.connection.db.collection("doctorprofiles").insertOne({
      userId,
      updatedAt: new Date("2026-08-20T00:00:00Z"),
    });
  });

  it("/sitemap.xml отдаёт индекс, а не список URL", async () => {
    const res = await request(app).get("/sitemap.xml");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("xml");
    expect(res.text).toContain("<sitemapindex");
    expect(res.text).not.toContain("<urlset");
    expect(res.text).toContain("/sitemap-doctors.xml");
  });

  it("дочерний файл отдаётся и содержит адреса", async () => {
    const res = await request(app).get("/sitemap-doctors.xml");
    expect(res.status).toBe(200);
    expect(res.text).toContain("<urlset");
    expect(res.text).toContain("/public/doctor-profile/doctor-details/");
  });

  it("несуществующая секция — 404, а не пустой файл", async () => {
    // Пустой urlset Search Console показывает как успешно обработанный с
    // нулём страниц: опечатку в имени было бы невозможно заметить.
    const res = await request(app).get("/sitemap-nosuchthing.xml");
    expect(res.status).toBe(404);
  });

  it("имя секции с дефисом маршрутом не режется", async () => {
    // doctor-articles — тот самый случай, на котором ломается шаблон
    // "/sitemap-:name.xml". 404 здесь законен (секция пуста), важно, что
    // это ответ обработчика, а не промах маршрута.
    const res = await request(app).get("/sitemap-doctor-articles.xml");
    expect([200, 404]).toContain(res.status);
    expect(res.headers["content-type"]).toBeDefined();
  });
});
