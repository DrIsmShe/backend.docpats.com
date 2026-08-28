// __tests__/surgery/maskGeometry.test.js
//
// Проверяется одно обещание: за пределами закрашенной зоны кадр остаётся
// исходным. Это не оптимизация и не «качество» — это единственное, что
// отличает симуляцию операции от генерации нового человека, и держится оно
// на арифметике composite, а не на послушании модели.

import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  analyzeMask,
  planCrop,
  compositeByMask,
  fillEnclosedAreas,
  strokeSurvival,
} from "../../modules/surgery/maskGeometry.js";

const W = 400;
const H = 600;

const solid = (w, h, rgb) =>
  sharp({ create: { width: w, height: h, channels: 3, background: rgb } })
    .png()
    .toBuffer();

/** Маска: чёрный кадр с белым прямоугольником — белое = править. */
async function maskWith(rect) {
  const base = await solid(W, H, { r: 0, g: 0, b: 0 });
  const patch = await solid(rect.width, rect.height, {
    r: 255,
    g: 255,
    b: 255,
  });
  return sharp(base)
    .composite([{ input: patch, left: rect.left, top: rect.top }])
    .png()
    .toBuffer();
}

const pixel = async (buf, x, y) => {
  const { data } = await sharp(buf)
    .extract({ left: x, top: y, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { r: data[0], g: data[1], b: data[2] };
};

describe("analyzeMask", () => {
  it("считает долю кадра и границы зоны в пикселях снимка", async () => {
    // 40×60 из 400×600 — ровно 1% кадра.
    const mask = await maskWith({ left: 100, top: 200, width: 40, height: 60 });
    const { paintedPct, bbox } = await analyzeMask(mask, W, H);

    expect(paintedPct).toBeGreaterThan(0.7);
    expect(paintedPct).toBeLessThan(1.4);
    // Допуск — цена анализа на уменьшенной копии; для padding'а кропа этого
    // с запасом достаточно.
    expect(bbox.left).toBeGreaterThan(90);
    expect(bbox.left).toBeLessThan(110);
    expect(bbox.top).toBeGreaterThan(190);
    expect(bbox.top).toBeLessThan(210);
  });

  it("на пустой маске не выдумывает зону", async () => {
    const mask = await solid(W, H, { r: 0, g: 0, b: 0 });
    const { paintedPct, bbox } = await analyzeMask(mask, W, H);
    expect(paintedPct).toBe(0);
    expect(bbox).toBeNull();
  });
});

describe("planCrop", () => {
  it("окно содержит зону правки и не выходит за кадр", async () => {
    const bbox = { left: 100, top: 200, width: 40, height: 60 };
    const region = planCrop(bbox, W, H);

    expect(region).not.toBeNull();
    expect(region.left).toBeGreaterThanOrEqual(0);
    expect(region.top).toBeGreaterThanOrEqual(0);
    expect(region.left + region.width).toBeLessThanOrEqual(W);
    expect(region.top + region.height).toBeLessThanOrEqual(H);
    expect(region.left).toBeLessThanOrEqual(bbox.left);
    expect(region.top).toBeLessThanOrEqual(bbox.top);
    expect(region.left + region.width).toBeGreaterThanOrEqual(
      bbox.left + bbox.width,
    );
    expect(region.top + region.height).toBeGreaterThanOrEqual(
      bbox.top + bbox.height,
    );
    expect(region.width % 16).toBe(0);
  });

  it("широкая полоса под глазами помещается в окно целиком", () => {
    // Зона шире, чем высока, — типичная маска нижних век. Окно, срезавшее
    // бы её края, оставило бы правку обрезанной по невидимой границе.
    const bbox = { left: 40, top: 300, width: 320, height: 40 };
    const region = planCrop(bbox, W, H);
    expect(region).not.toBeNull();
    expect(region.left).toBeLessThanOrEqual(bbox.left);
    expect(region.left + region.width).toBeGreaterThanOrEqual(
      bbox.left + bbox.width,
    );
    expect(region.top + region.height).toBeGreaterThanOrEqual(
      bbox.top + bbox.height,
    );
  });

  it("зона во весь кадр кропа не даёт — резать нечего", () => {
    const region = planCrop({ left: 0, top: 0, width: W, height: H }, W, H);
    expect(region).toBeNull();
  });
});

describe("compositeByMask", () => {
  it("вне маски отдаёт исходные пиксели, внутри — сгенерированные", async () => {
    const original = await solid(W, H, { r: 220, g: 30, b: 30 }); // красный
    const generated = await solid(W, H, { r: 30, g: 30, b: 220 }); // синий
    const mask = await maskWith({
      left: 150,
      top: 250,
      width: 100,
      height: 100,
    });

    const out = await compositeByMask(original, generated, mask, W, H, null);

    const outside = await pixel(out, 10, 10);
    expect(outside.r).toBeGreaterThan(200);
    expect(outside.b).toBeLessThan(60);

    const inside = await pixel(out, 200, 300);
    expect(inside.b).toBeGreaterThan(200);
    expect(inside.r).toBeLessThan(60);
  });

  it("работает через окно кропа: вставка ложится ровно в свои координаты", async () => {
    const original = await solid(W, H, { r: 220, g: 30, b: 30 });
    const mask = await maskWith({
      left: 150,
      top: 250,
      width: 100,
      height: 100,
    });
    const { bbox } = await analyzeMask(mask, W, H);
    const region = planCrop(bbox, W, H);
    expect(region).not.toBeNull();

    // Модель вернула окно целиком синим — как если бы нарисовала в нём
    // другого человека. За пределы маски это выйти не должно.
    const generated = await solid(region.width, region.height, {
      r: 30,
      g: 30,
      b: 220,
    });

    const out = await compositeByMask(original, generated, mask, W, H, region);

    const inside = await pixel(out, 200, 300);
    expect(inside.b).toBeGreaterThan(200);

    // Точка внутри ОКНА, но вне маски — обязана остаться исходной.
    const inWindowOutsideMask = await pixel(
      out,
      region.left + 2,
      region.top + 2,
    );
    expect(inWindowOutsideMask.r).toBeGreaterThan(200);
    expect(inWindowOutsideMask.b).toBeLessThan(60);

    // И дальний угол кадра — тем более.
    const far = await pixel(out, 5, 5);
    expect(far.r).toBeGreaterThan(200);
    expect(far.b).toBeLessThan(60);
  });

  it("итог всегда в размере оригинала, что бы ни вернула модель", async () => {
    const original = await solid(W, H, { r: 10, g: 200, b: 10 });
    const generated = await solid(123, 77, { r: 200, g: 10, b: 10 });
    const mask = await maskWith({ left: 50, top: 50, width: 80, height: 80 });

    const out = await compositeByMask(original, generated, mask, W, H, null);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(W);
    expect(meta.height).toBe(H);
  });
});

describe("fillEnclosedAreas", () => {
  const svg = (inner) =>
    sharp(
      Buffer.from(
        `<svg width="${W}" height="${H}"><rect width="100%" height="100%" fill="black"/>${inner}</svg>`,
      ),
    )
      .png()
      .toBuffer();

  it("обведённый контур становится залитой зоной", async () => {
    // Врач обвёл нос по контуру. Для модели это указание перерисовать
    // линию и НЕ трогать нос внутри неё: запрос остаётся невыполненным, а
    // на снимке появляется черта по следу кисти.
    const outline = await svg(
      `<ellipse cx="200" cy="300" rx="60" ry="90" fill="none" stroke="white" stroke-width="6"/>`,
    );

    const before = await analyzeMask(outline, W, H);
    const { mask, filledPct } = await fillEnclosedAreas(outline, W, H);
    const after = await analyzeMask(mask, W, H);

    expect(filledPct).toBeGreaterThan(1);
    expect(after.paintedPct).toBeGreaterThan(before.paintedPct * 3);

    // Центр контура теперь входит в зону правки.
    const { data } = await sharp(mask)
      .extract({ left: 200, top: 300, width: 1, height: 1 })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(127);
  });

  it("залитую зону не трогает", async () => {
    const solid = await svg(`<ellipse cx="200" cy="300" rx="60" ry="90" fill="white"/>`);
    const before = await analyzeMask(solid, W, H);
    const { filledPct } = await fillEnclosedAreas(solid, W, H);
    const after = await analyzeMask(
      (await fillEnclosedAreas(solid, W, H)).mask,
      W,
      H,
    );

    expect(filledPct).toBe(0);
    expect(after.paintedPct).toBeCloseTo(before.paintedPct, 1);
  });

  it("незамкнутый штрих остаётся штрихом — где замкнуть, мы не знаем", async () => {
    const stroke = await svg(
      `<path d="M 80 200 Q 200 170 320 200" fill="none" stroke="white" stroke-width="5"/>`,
    );
    const { filledPct } = await fillEnclosedAreas(stroke, W, H);
    expect(filledPct).toBe(0);
  });

  it("толщина отличает след кисти от зоны операции", async () => {
    // Тот признак, по которому воркер отклоняет штрих. Габарит для этого не
    // годился: пологий мазок плотно заполняет свой тонкий bbox и выглядел
    // полноценной зоной — тест на плотности проходил у обоих.
    const stroke = await svg(
      `<path d="M 80 200 Q 200 170 320 200" fill="none" stroke="white" stroke-width="5"/>`,
    );
    const zone = await svg(`<ellipse cx="200" cy="300" rx="60" ry="90" fill="white"/>`);

    expect(await strokeSurvival(stroke, W, H)).toBeLessThan(0.2);
    expect(await strokeSurvival(zone, W, H)).toBeGreaterThan(0.6);
  });

  it("обводка после заливки перестаёт быть штрихом", async () => {
    const outline = await svg(
      `<ellipse cx="200" cy="300" rx="60" ry="90" fill="none" stroke="white" stroke-width="6"/>`,
    );
    expect(await strokeSurvival(outline, W, H)).toBeLessThan(0.2);

    const { mask } = await fillEnclosedAreas(outline, W, H);
    expect(await strokeSurvival(mask, W, H)).toBeGreaterThan(0.6);
  });
});
