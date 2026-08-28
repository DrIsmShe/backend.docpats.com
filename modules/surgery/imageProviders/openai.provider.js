// modules/surgery/imageProviders/openai.provider.js
//
// Редактирование снимка через OpenAI, endpoint images/edits.
//
// ДВА РЕЖИМА, И ОСНОВНОЙ — БЕЗ МАСКИ.
//
// Маска в этом endpoint необязательна, и ChatGPT её не отправляет: модель
// сама находит на снимке лицо, нос, веки и правит то, о чём просят,
// оставляя остальное. Именно поэтому «убери мешки под глазами» в ChatGPT
// работает, а у нас месяцами не работало — мы навязывали маску, да ещё и
// вырезали зону из кадра. Модель получала кусок кожи без лица вокруг и
// честно рисовала в нём что придётся: чужой подбородок, шов по границе.
//
// Режим с маской остаётся для случая, когда врач хочет ограничить правку
// участком, — тогда действует прежний контракт: маска задаёт зону, а кадр
// потом собирается по ней в воркере.
//
// ПРО СОХРАНЕНИЕ ЛИЦА. У gpt-image-1 и gpt-image-1.5 за это отвечает
// input_fidelity: "high" — «faces are preserved far more accurately than in
// standard mode». У gpt-image-2 параметра нет вовсе: там высокая точность
// входа по умолчанию, и передача параметра ломает запрос. Отсюда развилка
// supportsInputFidelity().
//
// ТРИ РАЗЛИЧИЯ С fal, которые нельзя пропустить:
//
// 1. МАСКА ИНВЕРТИРОВАНА. У fal белое = «перерисовать». OpenAI правит там,
//    где маска ПРОЗРАЧНА (alpha = 0), а непрозрачное сохраняет.
// 2. РАЗМЕР НЕ СОХРАНЯЕТСЯ. Модель отдаёт свой размер, поэтому вход
//    вписывается с полями, а из ответа вырезается та же рамка.
// 3. НЕТ negative_prompt — запреты дописываются в конец промта текстом.

import sharp from "sharp";

// gpt-image-2 — самая свежая модель редактирования. input_fidelity ей не
// передаётся: параметра у неё нет вовсе, высокая точность входа там
// поведение по умолчанию (см. supportsInputFidelity ниже).
//
// Читаем env на каждом вызове, а не один раз при импорте: константа
// замораживала выбор модели на момент загрузки модуля, из-за чего её нельзя
// было ни подменить в тесте, ни переключить чем-либо кроме перезапуска.
const model = () => (process.env.OPENAI_IMAGE_MODEL || "gpt-image-2").trim();
const quality = () => (process.env.OPENAI_IMAGE_QUALITY || "high").trim();
const ENDPOINT = "https://api.openai.com/v1/images/edits";

// Размеры, которые умеют отдавать модели семейства gpt-image.
const SIZES = [
  { label: "1024x1024", w: 1024, h: 1024 },
  { label: "1536x1024", w: 1536, h: 1024 },
  { label: "1024x1536", w: 1024, h: 1536 },
];

function key() {
  return (process.env.OPENAI_API_KEY || "").trim();
}

/**
 * Принимает ли модель input_fidelity. У gpt-image-2 параметра нет, и запрос
 * с ним отклоняется — молчаливой деградации тут не будет, поэтому проверка
 * по имени модели, а не «попробуем и посмотрим».
 */
export function supportsInputFidelity(name = model()) {
  return /^gpt-image-1(\.5|-mini)?$/.test(name) || name === "chatgpt-image-latest";
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
 * Рамка вписывания входа в размер модели: во что превратится кадр и где
 * он окажется. Обратное извлечение из ответа считается по ней же.
 */
export function fitBox(width, height, size) {
  const scale = Math.min(size.w / width, size.h / height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  return {
    width: w,
    height: h,
    left: Math.floor((size.w - w) / 2),
    top: Math.floor((size.h - h) / 2),
  };
}

/**
 * Наша маска (белое = править) → маска OpenAI (прозрачное = править),
 * вписанная в размер модели. Поля вокруг кадра делаем НЕПРОЗРАЧНЫМИ:
 * там править нечего, и разрешать модели дорисовывать за краем снимка —
 * значит получить фантазию вместо фона.
 */
export async function toOpenAiMask(maskBuffer, box, size) {
  const alpha = await sharp(maskBuffer)
    .resize(box.width, box.height, { fit: "fill" })
    .greyscale()
    .negate() // белое (править) → 0, чёрное (сохранить) → 255
    .extend({
      top: box.top,
      left: box.left,
      bottom: size.h - box.height - box.top,
      right: size.w - box.width - box.left,
      background: { r: 255, g: 255, b: 255 }, // поля = сохранить
    })
    .raw()
    .toBuffer();

  return sharp({
    create: {
      width: size.w,
      height: size.h,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .joinChannel(alpha, { raw: { width: size.w, height: size.h, channels: 1 } })
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
    const box = fitBox(meta.width, meta.height, size);

    // Вход вписываем с полями, а не кадрируем: обрезав часть снимка, вернуть
    // результат на место попиксельно уже нельзя.
    const image = await sharp(imageBuffer)
      .resize(box.width, box.height, { fit: "fill" })
      .extend({
        top: box.top,
        left: box.left,
        bottom: size.h - box.height - box.top,
        right: size.w - box.width - box.left,
        background: { r: 0, g: 0, b: 0 },
      })
      .png()
      .toBuffer();

    const fullPrompt = negativePrompt
      ? `${prompt}\n\nAvoid: ${negativePrompt}`
      : prompt;

    const form = new FormData();
    const modelName = model();
    form.append("model", modelName);
    form.append("prompt", fullPrompt);
    form.append("n", String(numOutputs || 4));
    form.append("size", size.label);
    form.append("quality", quality());
    form.append("image", new Blob([image], { type: "image/png" }), "photo.png");

    // Ради лица и существует этот параметр. Без него модель «пересказывает»
    // черты по-своему, и пациент перестаёт быть собой.
    if (supportsInputFidelity(modelName)) {
      form.append("input_fidelity", "high");
    }

    if (maskBuffer) {
      const mask = await toOpenAiMask(maskBuffer, box, size);
      form.append("mask", new Blob([mask], { type: "image/png" }), "mask.png");
    }

    console.log(
      `📤 [openai] ${modelName}, ${meta.width}x${meta.height} → ${size.label},` +
        ` ${maskBuffer ? "с маской" : "без маски (правка по инструкции)"}` +
        `${supportsInputFidelity(modelName) ? ", input_fidelity=high" : ""}`,
    );

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

    const raw = await Promise.all(
      items.map(async (item) => {
        if (item.b64_json) return Buffer.from(item.b64_json, "base64");
        if (item.url) {
          const r = await fetch(item.url);
          if (!r.ok) throw new Error(`openai скачивание ${r.status}`);
          return Buffer.from(await r.arrayBuffer());
        }
        throw new Error("openai: в ответе нет ни b64_json, ни url");
      }),
    );

    // Снимаем поля и возвращаем размер входа.
    //
    // ДВА ПРОХОДА, А НЕ ОДНА ЦЕПОЧКА. sharp допускает один resize на
    // пайплайн: второй вызов не добавляется, а ЗАМЕНЯЕТ первый, и extract
    // между ними начинает отсчитываться от финального размера. Рамка
    // 1536×768 в кадре 452×679 не помещается — наружу это выходило как
    // «extract_area: bad extract area» без единого намёка на причину.
    const images = await Promise.all(
      raw.map(async (buf) => {
        const framed = await sharp(buf)
          .resize(size.w, size.h, { fit: "fill" })
          .extract({
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
          })
          .png()
          .toBuffer();

        return sharp(framed)
          .resize(meta.width, meta.height, { fit: "fill" })
          .png()
          .toBuffer();
      }),
    );

    return {
      requestId: data.created ? String(data.created) : "openai",
      images,
      ext: "png",
    };
  },
};

export default openaiProvider;
