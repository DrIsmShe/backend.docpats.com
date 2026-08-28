// Подготовка маски для OpenAI и выбор провайдера.
//
// Проверяется прежде всего ИНВЕРСИЯ МАСКИ. У fal белое означает «здесь
// перерисовать», у OpenAI правится то, что ПРОЗРАЧНО. Перепутать эти две
// договорённости — значит перерисовать ровно ту часть снимка, которую
// врач хотел сохранить, и заметить это можно будет только по результату,
// уже потратив деньги на генерацию.

import { describe, it, expect, vi, afterEach } from "vitest";
import sharp from "sharp";
import {
  toOpenAiMask,
  pickSize,
  fitBox,
} from "../../modules/surgery/imageProviders/openai.provider.js";
import {
  openaiProvider,
  supportsInputFidelity,
  explainFailure,
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

// Размер модели и рамка вписывания. Раньше вход подгонялся кадрированием
// (fit: "cover"), и вернуть результат на место попиксельно было уже нельзя —
// часть кадра просто отрезана. Теперь кадр вписывается с полями, а из ответа
// вырезается та же рамка.
const SIZE = { label: "1024x1024", w: W, h: H };
const BOX = { left: 0, top: 0, width: W, height: H };

describe("маска для OpenAI", () => {
  it("делает ПРОЗРАЧНЫМ то, что у нас помечено белым", async () => {
    const mask = await toOpenAiMask(await maskWithWhiteSquare(), BOX, SIZE);
    const alpha = await alphaOf(mask);

    // Центр квадрата: врач пометил его к правке → OpenAI ждёт alpha = 0.
    expect(alpha.at(32, 32)).toBe(0);
  });

  it("оставляет НЕПРОЗРАЧНЫМ всё, что должно сохраниться", async () => {
    const mask = await toOpenAiMask(await maskWithWhiteSquare(), BOX, SIZE);
    const alpha = await alphaOf(mask);

    // Углы — за пределами белого квадрата.
    expect(alpha.at(0, 0)).toBe(255);
    expect(alpha.at(63, 63)).toBe(255);
    expect(alpha.at(0, 63)).toBe(255);
  });

  it("отдаёт RGBA размера модели — endpoint требует совпадения с фото", async () => {
    const size = { label: "128x96", w: 128, h: 96 };
    const box = { left: 0, top: 0, width: 128, height: 96 };
    const mask = await toOpenAiMask(await maskWithWhiteSquare(), box, size);
    const meta = await sharp(mask).metadata();

    expect(meta.width).toBe(128);
    expect(meta.height).toBe(96);
    expect(meta.hasAlpha).toBe(true);
  });

  it("поля вокруг вписанного кадра непрозрачны — за краем снимка править нечего", async () => {
    // Кадр 64×64 вписан в 128×96: сверху и снизу остаются поля. Прозрачные
    // поля означали бы «дорисуй за краем фотографии», и модель охотно
    // дорисовывает — фон, плечи, чужую одежду.
    const size = { label: "128x96", w: 128, h: 96 };
    const box = fitBox(W, H, size);
    const mask = await toOpenAiMask(await maskWithWhiteSquare(), box, size);
    const alpha = await alphaOf(mask);

    expect(box.width).toBe(96);
    expect(box.top).toBe(0);
    expect(box.left).toBe(16);
    expect(alpha.at(2, 2)).toBe(255);
    expect(alpha.at(125, 90)).toBe(255);
  });

  it("белое полотно целиком прозрачно — это режим «перерисовать весь кадр»", async () => {
    const white = await sharp({
      create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer();

    const alpha = await alphaOf(await toOpenAiMask(white, BOX, SIZE));
    expect(alpha.at(0, 0)).toBe(0);
    expect(alpha.at(32, 32)).toBe(0);
  });
});

describe("рамка вписывания", () => {
  it("сохраняет пропорции и центрирует кадр", () => {
    const box = fitBox(1000, 500, { w: 1024, h: 1024 });
    expect(box.width).toBe(1024);
    expect(box.height).toBe(512);
    expect(box.left).toBe(0);
    expect(box.top).toBe(256);
  });

  it("совпадающая пропорция полей не оставляет", () => {
    const box = fitBox(2000, 3000, { w: 1024, h: 1536 });
    expect(box.left).toBe(0);
    expect(box.top).toBe(0);
    expect(box.width).toBe(1024);
    expect(box.height).toBe(1536);
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

describe("ответ OpenAI возвращается в геометрии входа", () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalKey;
    vi.restoreAllMocks();
  });

  // Воркер собирает кадр по маске, накладывая ответ модели на исходный
  // снимок. Любое расхождение размеров сдвинуло бы правку — поэтому
  // провайдер обязан вернуть ровно ту геометрию, которую получил.
  //
  // Регрессия, стоившая рабочего дня: снятие полей и возврат к размеру
  // входа стояли ОДНОЙ цепочкой sharp — resize → extract → resize. Sharp
  // допускает один resize на пайплайн: второй не добавляется, а заменяет
  // первый, и extract начинал отсчитываться от финального размера. Врач
  // видел «extract_area: bad extract area» без единого намёка на причину.
  it("снимает поля и отдаёт размер входа, а не размер модели", async () => {
    process.env.OPENAI_API_KEY = "test-key";

    const input = await sharp({
      create: { width: 448, height: 224, channels: 3, background: { r: 200, g: 180, b: 170 } },
    })
      .png()
      .toBuffer();
    const inputMask = await maskWithWhiteSquare();

    // gpt-image-1 отвечает своим размером — 1536×1024 для такой пропорции.
    const modelAnswer = await sharp({
      create: { width: 1536, height: 1024, channels: 3, background: { r: 20, g: 40, b: 200 } },
    })
      .png()
      .toBuffer();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({ created: 1, data: [{ b64_json: modelAnswer.toString("base64") }] }),
    });

    const { images } = await openaiProvider.run({
      imageBuffer: input,
      maskBuffer: inputMask,
      prompt: "x",
      negativePrompt: "y",
      numOutputs: 1,
    });

    const meta = await sharp(images[0]).metadata();
    expect(meta.width).toBe(448);
    expect(meta.height).toBe(224);
  });
});

describe("правка без маски — основной режим", () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_IMAGE_MODEL;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.OPENAI_IMAGE_MODEL;
    else process.env.OPENAI_IMAGE_MODEL = originalModel;
    vi.restoreAllMocks();
  });

  async function callWithoutMask() {
    process.env.OPENAI_API_KEY = "test-key";
    const input = await sharp({
      create: { width: 452, height: 679, channels: 3, background: { r: 200, g: 180, b: 170 } },
    })
      .png()
      .toBuffer();
    const answer = await sharp({
      create: { width: 1024, height: 1536, channels: 3, background: { r: 20, g: 40, b: 200 } },
    })
      .png()
      .toBuffer();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({ created: 1, data: [{ b64_json: answer.toString("base64") }] }),
    });
    global.fetch = fetchMock;

    const result = await openaiProvider.run({
      imageBuffer: input,
      maskBuffer: null,
      prompt: "Raise the nasal tip slightly.",
      negativePrompt: "",
      numOutputs: 1,
    });
    return { fetchMock, result };
  }

  // Маска в images/edits необязательна, и ChatGPT её не шлёт: модель сама
  // находит на снимке лицо и правит то, о чём просят. Навязанная маска —
  // причина, по которой «убери мешки под глазами» у нас не работало.
  it("маска в запрос не попадает вовсе", async () => {
    const { fetchMock } = await callWithoutMask();
    const body = fetchMock.mock.calls[0][1].body;
    expect(body.has("mask")).toBe(false);
    expect(body.has("image")).toBe(true);
    expect(body.get("prompt")).toContain("Raise the nasal tip");
  });

  it("модель по умолчанию — gpt-image-2", async () => {
    const { fetchMock } = await callWithoutMask();
    expect(fetchMock.mock.calls[0][1].body.get("model")).toBe("gpt-image-2");
    // У неё параметра нет вовсе, и запрос с ним отклоняется.
    expect(fetchMock.mock.calls[0][1].body.has("input_fidelity")).toBe(false);
  });

  it("старым моделям лицо держит input_fidelity=high", async () => {
    process.env.OPENAI_IMAGE_MODEL = "gpt-image-1.5";
    const { fetchMock } = await callWithoutMask();
    expect(fetchMock.mock.calls[0][1].body.get("input_fidelity")).toBe("high");
  });

  it("результат возвращается в размере оригинала", async () => {
    const { result } = await callWithoutMask();
    const meta = await sharp(result.images[0]).metadata();
    expect(meta.width).toBe(452);
    expect(meta.height).toBe(679);
  });

  // У gpt-image-2 параметра нет вовсе, и запрос с ним отклоняется: там
  // высокая точность входа — поведение по умолчанию.
  it("модели без input_fidelity его не получают", () => {
    expect(supportsInputFidelity("gpt-image-1.5")).toBe(true);
    expect(supportsInputFidelity("gpt-image-1")).toBe(true);
    expect(supportsInputFidelity("gpt-image-2")).toBe(false);
    expect(supportsInputFidelity("gpt-image-2-2026-04-21")).toBe(false);
  });
});

describe("ошибки поставщика — на человеческом языке", () => {
  // Текст ошибки врач видит прямо в карточке симуляции. Сырой JSON вида
  // «insufficient_quota ... credit_balance_exhausted» читается как поломка
  // платформы, хотя означает пустой счёт и лечится за минуту.
  const body = (code, message) =>
    JSON.stringify({ error: { code, message, type: code } });

  it("пустой счёт объясняется, а не показывается кодом", () => {
    const out = explainFailure(
      429,
      body("insufficient_quota", "You have no credits remaining."),
    );
    expect(out).toMatch(/закончились средства/i);
    expect(out).toMatch(/Billing/);
    expect(out).not.toMatch(/insufficient_quota/);
  });

  it("превышение частоты отличается от пустого счёта", () => {
    const out = explainFailure(429, body("rate_limit_exceeded", "Slow down"));
    expect(out).toMatch(/Слишком много запросов/i);
  });

  it("отказ по контент-политике подсказывает, что делать", () => {
    const out = explainFailure(
      400,
      body("moderation_blocked", "Your request was rejected by safety system"),
    );
    expect(out).toMatch(/правилам безопасности/i);
  });

  it("негодный ключ называется негодным ключом", () => {
    const out = explainFailure(401, body("invalid_api_key", "Incorrect key"));
    expect(out).toMatch(/Ключ OpenAI не принят/i);
  });

  it("неизвестную ошибку не выдумывает, а показывает как есть", () => {
    const out = explainFailure(418, "I am a teapot");
    expect(out).toMatch(/openai 418/);
    expect(out).toMatch(/teapot/);
  });
});
