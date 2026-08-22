// modules/surgery/imageProviders/openai.provider.js
//
// Инпейнт через OpenAI, модель gpt-image-1 (endpoint images/edits).
//
// Почему он тут вообще. OPENAI_API_KEY у платформы уже есть и оплачен —
// на нём работает вся остальная AI-начинка. Включение этого провайдера не
// заводит нового поставщика, нового договора и новой утечки данных туда,
// где их ещё не было.
//
// ТРИ РАЗЛИЧИЯ С fal, которые нельзя пропустить:
//
// 1. МАСКА ИНВЕРТИРОВАНА. У fal белое = «перерисовать». OpenAI правит там,
//    где маска ПРОЗРАЧНА (alpha = 0), а непрозрачное сохраняет. Отдать ему
//    нашу маску как есть — значит перерисовать ровно то, что врач хотел
//    оставить. Поэтому ниже строится RGBA-маска с альфой = 255 − яркость.
//
// 2. РАЗМЕР НЕ СОХРАНЯЕТСЯ. Модель отдаёт изображение одного из своих
//    размеров, а не размер оригинала. Выбираем ближайший по пропорции —
//    иначе лицо растянет. Полного соответствия исходному кадру тут не
//    будет, и это плата за отсутствие второго вендора.
//
// 3. НЕТ negative_prompt. У endpoint такого параметра нет вовсе,
//    поэтому запреты дописываются в конец основного промта обычным
//    текстом. Действует слабее, чем настоящий негативный промт.

import sharp from "sharp";

const MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
const ENDPOINT = "https://api.openai.com/v1/images/edits";

// Размеры, которые модель умеет отдавать.
const SIZES = [
  { label: "1024x1024", w: 1024, h: 1024 },
  { label: "1536x1024", w: 1536, h: 1024 },
  { label: "1024x1536", w: 1024, h: 1536 },
];

function key() {
  return (process.env.OPENAI_API_KEY || "").trim();
}

/** Ближайший поддерживаемый размер по соотношению сторон. */
export function pickSize(width, height) {
  const ratio = width / height;
  let best = SIZES[0];
  let bestDiff = Infinity;
  for (const s of SIZES) {
    const diff = Math.abs(s.w / s.h - ratio);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = s;
    }
  }
  return best;
}

/**
 * Наша маска (белое = править) → маска OpenAI (прозрачное = править).
 * RGB кладём чёрным: он не используется, значение имеет только альфа.
 */
export async function toOpenAiMask(maskBuffer, width, height) {
  const alpha = await sharp(maskBuffer)
    .resize(width, height, { fit: "fill" })
    .greyscale()
    .negate() // белое (править) → 0, чёрное (сохранить) → 255
    .raw()
    .toBuffer();

  return sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
}

export const openaiProvider = {
  name: "openai",

  isConfigured() {
    return Boolean(key());
  },

  missingHint: "OPENAI_API_KEY не задан в .env",

  async run({ imageBuffer, maskBuffer, prompt, negativePrompt, numOutputs }) {
    const OPENAI_KEY = key();
    if (!OPENAI_KEY) throw new Error(this.missingHint);

    const meta = await sharp(imageBuffer).metadata();
    const size = pickSize(meta.width, meta.height);
    console.log(
      `📐 [openai] ${meta.width}x${meta.height} → ${size.label} (ближайшая пропорция)`,
    );

    // Приводим оба файла к одному размеру: endpoint требует совпадения
    // размеров фото и маски, иначе отвечает 400 без внятного объяснения.
    const image = await sharp(imageBuffer)
      .resize(size.w, size.h, { fit: "cover" })
      .png()
      .toBuffer();
    const mask = await toOpenAiMask(maskBuffer, size.w, size.h);

    const fullPrompt = negativePrompt
      ? `${prompt}\n\nAvoid: ${negativePrompt}`
      : prompt;

    const form = new FormData();
    form.append("model", MODEL);
    form.append("prompt", fullPrompt);
    form.append("n", String(numOutputs || 4));
    form.append("size", size.label);
    form.append("image", new Blob([image], { type: "image/png" }), "photo.png");
    form.append("mask", new Blob([mask], { type: "image/png" }), "mask.png");

    console.log(`📤 [openai] отправка, модель: ${MODEL}`);

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      body: form,
    });

    const text = await res.text();
    if (!res.ok) {
      // Отказ по политике контента здесь обычен: лица и медицинская
      // тематика проверяются строже. Показываем причину как есть, чтобы
      // врач не гадал, сломалось или запрещено.
      throw new Error(`openai ${res.status}: ${text.slice(0, 400)}`);
    }

    const data = JSON.parse(text);
    const items = data.data || [];
    if (items.length === 0) {
      throw new Error(`openai вернул пустой data: ${text.slice(0, 300)}`);
    }

    const images = await Promise.all(
      items.map(async (item) => {
        if (item.b64_json) return Buffer.from(item.b64_json, "base64");
        // Часть моделей отдаёт ссылку вместо base64.
        if (item.url) {
          const r = await fetch(item.url);
          if (!r.ok) throw new Error(`openai скачивание ${r.status}`);
          return Buffer.from(await r.arrayBuffer());
        }
        throw new Error("openai: в ответе нет ни b64_json, ни url");
      }),
    );

    return { requestId: data.created ? String(data.created) : "openai", images, ext: "png" };
  },
};

export default openaiProvider;
