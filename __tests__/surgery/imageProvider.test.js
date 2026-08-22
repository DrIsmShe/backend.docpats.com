// Подготовка маски для OpenAI и выбор провайдера.
//
// Проверяется прежде всего ИНВЕРСИЯ МАСКИ. У fal белое означает «здесь
// перерисовать», у OpenAI правится то, что ПРОЗРАЧНО. Перепутать эти две
// договорённости — значит перерисовать ровно ту часть снимка, которую
// врач хотел сохранить, и заметить это можно будет только по результату,
// уже потратив деньги на генерацию.

import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  toOpenAiMask,
  pickSize,
} from "../../modules/surgery/imageProviders/openai.provider.js";
import { getImageProvider } from "../../modules/surgery/imageProviders/index.js";

const W = 64;
const H = 64;

/** Наша маска: чёрный фон, белый квадрат 16×16 в центре = «править тут». */
async function maskWithWhiteSquare() {
  const square = await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();

  return sharp({
    create: { width: W, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([{ input: square, top: 24, left: 24 }])
    .png()
    .toBuffer();
}

/** Альфа-канал результата, чтобы смотреть на прозрачность попиксельно. */
async function alphaOf(pngBuffer) {
  const { data, info } = await sharp(pngBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const at = (x, y) => data[(y * info.width + x) * info.channels + 3];
  return { at, channels: info.channels, width: info.width, height: info.height };
}

describe("маска для OpenAI", () => {
  it("делает ПРОЗРАЧНЫМ то, что у нас помечено белым", async () => {
    const mask = await toOpenAiMask(await maskWithWhiteSquare(), W, H);
    const alpha = await alphaOf(mask);

    // Центр квадрата: врач пометил его к правке → OpenAI ждёт alpha = 0.
    expect(alpha.at(32, 32)).toBe(0);
  });

  it("оставляет НЕПРОЗРАЧНЫМ всё, что должно сохраниться", async () => {
    const mask = await toOpenAiMask(await maskWithWhiteSquare(), W, H);
    const alpha = await alphaOf(mask);

    // Углы — за пределами белого квадрата.
    expect(alpha.at(0, 0)).toBe(255);
    expect(alpha.at(63, 63)).toBe(255);
    expect(alpha.at(0, 63)).toBe(255);
  });

  it("отдаёт RGBA нужного размера — endpoint требует совпадения с фото", async () => {
    const mask = await toOpenAiMask(await maskWithWhiteSquare(), 128, 96);
    const meta = await sharp(mask).metadata();

    expect(meta.width).toBe(128);
    expect(meta.height).toBe(96);
    expect(meta.hasAlpha).toBe(true);
  });

  it("белое полотно целиком прозрачно — это режим «перерисовать весь кадр»", async () => {
    const white = await sharp({
      create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer();

    const alpha = await alphaOf(await toOpenAiMask(white, W, H));
    expect(alpha.at(0, 0)).toBe(0);
    expect(alpha.at(32, 32)).toBe(0);
  });
});

describe("выбор размера под пропорцию снимка", () => {
  it("квадратное фото — квадратный размер", () => {
    expect(pickSize(800, 800).label).toBe("1024x1024");
  });

  it("портрет — вертикальный размер, а не растянутый квадрат", () => {
    expect(pickSize(1000, 1500).label).toBe("1024x1536");
  });

  it("альбом — горизонтальный", () => {
    expect(pickSize(1920, 1280).label).toBe("1536x1024");
  });
});

describe("выбор провайдера", () => {
  it("по умолчанию fal — прежнее поведение не меняется", () => {
    delete process.env.IMAGE_PROVIDER;
    expect(getImageProvider().name).toBe("fal");
  });

  it("переключается переменной окружения", () => {
    process.env.IMAGE_PROVIDER = "openai";
    expect(getImageProvider().name).toBe("openai");
    delete process.env.IMAGE_PROVIDER;
  });

  it("на неизвестное имя падает внятно, а не молча берёт первый попавшийся", () => {
    process.env.IMAGE_PROVIDER = "midjourney";
    expect(() => getImageProvider()).toThrow(/неизвестен/);
    delete process.env.IMAGE_PROVIDER;
  });
});
