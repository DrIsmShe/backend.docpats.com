// __tests__/radiology/catalogPagination.test.js
//
// Каталог на большом числе кейсов.
//
// Проверяется ровно то, что раньше было сломано и о чём никто бы не узнал:
// список отдавал первые 50 (снимки) или 200 (анализы, виртуальный пациент) без
// какого-либо признака усечения. Интерфейс показывал их и писал «всего N», где
// N — размер куска, а не каталога. Врач искал кейс, не находил и делал вывод,
// что кейса нет.
//
// Поэтому тесты здесь не про «работает ли skip», а про три утверждения:
//   1. total считает ВЕСЬ каталог, а не отданную страницу;
//   2. страницы не теряют и не дублируют кейсы;
//   3. поиск идёт по базе, то есть находит и то, что лежит за пределами
//      первой страницы.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";

const RadiologyCase = (
  await import("../../modules/radiology/radiology-cases/models/radiologyCase.model.js")
).default;
const { listCases } = await import(
  "../../modules/radiology/radiology-cases/services/case.service.js"
);
const { escapeRegex, titleFilter, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } = await import(
  "../../modules/radiology/catalog.js"
);

const authorId = new mongoose.Types.ObjectId();

// 70 опубликованных кейсов: больше прежнего умолчания в 50, чтобы поймать
// именно молчаливое усечение.
const TOTAL = 70;

async function seed() {
  const docs = [];
  for (let i = 0; i < TOTAL; i += 1) {
    docs.push({
      modality: "cxr",
      title: `Кейс ${String(i).padStart(3, "0")}${i === 65 ? " — редкая находка" : ""}`,
      difficulty: i % 3 === 0 ? "hard" : "medium",
      images: [{ url: `https://example.test/${i}.jpg` }],
      findings: [],
      impression: { correctText: "секрет", diagnosisKeys: ["ответ"] },
      source: { kind: "original" },
      deidentified: true,
      status: "published",
      createdBy: authorId,
      // Разные даты, иначе порядок между страницами не определён и тест
      // ловил бы собственную недосказанность, а не ошибку кода.
      createdAt: new Date(2026, 0, 1 + i),
    });
  }
  await RadiologyCase.insertMany(docs);
}

beforeEach(seed);

describe("каталог не усекается молча", () => {
  it("total — размер всего каталога, а не отданной страницы", async () => {
    const page = await listCases({ filters: {}, isEditor: false });

    expect(page.items).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(page.total).toBe(TOTAL); // ← раньше клиент видел бы 50 и считал их всеми
    expect(page.hasMore).toBe(true);
  });

  it("на последней странице hasMore выключается", async () => {
    const page = await listCases({ filters: { skip: 60, limit: 24 }, isEditor: false });
    expect(page.items).toHaveLength(TOTAL - 60);
    expect(page.hasMore).toBe(false);
  });

  it("страницы покрывают каталог целиком, без потерь и повторов", async () => {
    const seen = new Set();
    for (let skip = 0; skip < TOTAL; skip += 25) {
      const page = await listCases({ filters: { skip, limit: 25 }, isEditor: false });
      for (const item of page.items) seen.add(String(item._id));
    }
    expect(seen.size).toBe(TOTAL);
  });

  it("размер страницы ограничен сверху — клиент не выкачает каталог одним запросом", async () => {
    const page = await listCases({ filters: { limit: 5000 }, isEditor: false });
    expect(page.items.length).toBeLessThanOrEqual(MAX_PAGE_SIZE);
    expect(page.total).toBe(TOTAL);
  });

  it("эталон ответа не уезжает в список ни на одной странице", async () => {
    const page = await listCases({ filters: { skip: 24, limit: 24 }, isEditor: false });
    for (const item of page.items) {
      expect(item.findings).toBeUndefined();
      expect(item.impression).toBeUndefined();
    }
  });
});

describe("поиск идёт по базе, а не по видимому куску", () => {
  it("находит кейс, который лежит далеко за первой страницей", async () => {
    // Кейс №65 не попал бы ни в одну первую страницу — на клиенте его было бы
    // не найти в принципе.
    const page = await listCases({ filters: { q: "редкая находка" }, isEditor: false });
    expect(page.total).toBe(1);
    expect(page.items[0].title).toContain("редкая находка");
  });

  it("регистр не важен", async () => {
    const page = await listCases({ filters: { q: "РЕДКАЯ" }, isEditor: false });
    expect(page.total).toBe(1);
  });

  it("total учитывает фильтр, а не весь каталог", async () => {
    // Названия — «Кейс 000»…«Кейс 069», поэтому «Кейс 01» совпадает ровно с
    // десятью (010–019) и результат не зависит от размера страницы.
    const page = await listCases({ filters: { q: "Кейс 01" }, isEditor: false });
    expect(page.total).toBe(10);
    expect(page.items).toHaveLength(10);
  });

  it("фильтры совмещаются", async () => {
    const all = await listCases({ filters: {}, isEditor: false });
    const hard = await listCases({ filters: { difficulty: "hard" }, isEditor: false });
    expect(hard.total).toBeGreaterThan(0);
    expect(hard.total).toBeLessThan(all.total);
  });

  it("черновики не видны учащемуся даже через поиск", async () => {
    await RadiologyCase.create({
      modality: "cxr",
      title: "Черновик с редкая находка внутри",
      difficulty: "easy",
      images: [{ url: "https://example.test/d.jpg" }],
      source: { kind: "original" },
      status: "draft",
      createdBy: authorId,
    });
    const page = await listCases({ filters: { q: "редкая находка" }, isEditor: false });
    expect(page.total).toBe(1); // только опубликованный
  });
});

describe("строка поиска не ломает запрос", () => {
  it("метасимволы экранируются, а не исполняются", () => {
    expect(escapeRegex("C++ (3) [x]")).toBe("C\\+\\+ \\(3\\) \\[x\\]");
  });

  it("поиск по строке со спецсимволами не падает и ничего не находит", async () => {
    // До экранирования такой ввод либо валил запрос, либо превращался в
    // шаблон «что угодно» и возвращал весь каталог как «совпадения».
    const page = await listCases({ filters: { q: ".*" }, isEditor: false });
    expect(page.total).toBe(0);
  });

  it("пустой и пробельный запрос — это отсутствие фильтра, а не поиск пустоты", () => {
    expect(titleFilter("")).toBeNull();
    expect(titleFilter("   ")).toBeNull();
    expect(titleFilter(null)).toBeNull();
  });
});
