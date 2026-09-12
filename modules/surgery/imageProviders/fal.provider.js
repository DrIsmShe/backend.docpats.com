// modules/surgery/imageProviders/fal.provider.js
//
// Инпейнт через fal.ai, модель flux-pro/v1/fill.
//
// Модель специализированная: перерисовывает только область маски и лучше
// прочих сохраняет окружение — для фотографии пациента это главное, там
// меняться должен нос, а не освещение и текстура кожи вокруг.
//
// Маска здесь в прямой логике: БЕЛОЕ — то, что перерисовать. Это важно
// помнить, потому что у OpenAI ровно наоборот (см. соседний файл).
//
// Работа асинхронная: submit → опрос статуса → забрать результат.

// Две модели, потому что задачи разные. Fill заполняет отмеченную зону и
// без маски работать не может вовсе. Правка по инструкции — «подними
// кончик носа» — маски не требует: модель сама находит нужное место.
//
// ПОЧЕМУ НЕ FLUX KONTEXT. Он стоял здесь и на клинических снимках просто
// не делал правку: на профильном фото с выраженной горбинкой и kontext, и
// kontext/max возвращали тот же нос — проверено прогонами через этот же
// провайдер. Дело не в формулировке: грубое «сделай нос заметно меньше»
// он тоже отработал едва различимо. Nano Banana (Gemini 2.5 Flash Image)
// на том же снимке и том же запросе выпрямляет спинку носа и поднимает
// кончик — видно невооружённым глазом.
//
// Старая модель остаётся доступной через FAL_EDIT_MODEL: форма запроса у
// семейств разная, и переключение учитывает это ниже, в run().
const MODEL = process.env.FAL_MODEL || "fal-ai/flux-pro/v1/fill";
const EDIT_MODEL = process.env.FAL_EDIT_MODEL || "fal-ai/nano-banana/edit";
const MAX_WAIT_MS = 180_000;
const POLL_INTERVAL_MS = 3_000;

function key() {
  return (process.env.FAL_KEY || "").trim();
}

function toDataUri(buf, mime) {
  return `data:${mime};base64,${buf.toString("base64")}`;
}

// MIME определяем по самим байтам, а не по названию поля. Воркер отдаёт
// сюда то кроп зоны в PNG, то исходный JPEG целиком, и жёстко зашитое
// "image/jpeg" в data-URI означало бы, что часть запросов уезжает с
// заведомо ложным типом.
export function sniffMime(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf.length > 12 && buf.slice(8, 12).toString("ascii") === "WEBP")
    return "image/webp";
  return "image/jpeg";
}

export const falProvider = {
  name: "fal",

  isConfigured() {
    return Boolean(key());
  },

  missingHint: "FAL_KEY не задан в .env",

  async run({ imageBuffer, maskBuffer, prompt, negativePrompt, numOutputs }) {
    const FAL_KEY = key();
    if (!FAL_KEY) throw new Error(this.missingHint);

    const model = maskBuffer ? MODEL : EDIT_MODEL;
    const dataUri = toDataUri(imageBuffer, sniffMime(imageBuffer));

    // Форма запроса зависит от семейства модели. Nano Banana принимает
    // МАССИВ image_urls и не знает ни guidance_scale, ни negative_prompt;
    // FLUX принимает одиночный image_url. Перепутать нельзя: лишнее поле
    // возвращается как 422, а не игнорируется.
    const nanoBanana = model.includes("nano-banana");

    const body = nanoBanana
      ? {
          prompt,
          image_urls: [dataUri],
          num_images: numOutputs || 1,
          output_format: "jpeg",
        }
      : {
          image_url: dataUri,
          prompt,
          num_images: numOutputs || 1,
          output_format: "jpeg",
          safety_tolerance: "5",
        };

    if (maskBuffer) {
      body.mask_url = toDataUri(maskBuffer, sniffMime(maskBuffer));
      body.negative_prompt = negativePrompt;
    } else if (!nanoBanana) {
      // Насколько буквально FLUX следует инструкции. Значение по умолчанию
      // (3.5) настроено на бытовые правки, где осторожность уместна; на
      // клинических снимках она оборачивается тем, что модель возвращает
      // почти исходный кадр.
      body.guidance_scale = Number(process.env.FAL_EDIT_GUIDANCE || 4);
    }

    console.log(
      `📤 [fal] отправка, модель: ${model}` +
        `${maskBuffer ? "" : " (правка по инструкции, без маски)"}`,
    );

    const submitRes = await fetch(`https://queue.fal.run/${model}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${FAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const submitText = await submitRes.text();
    if (!submitRes.ok) {
      throw new Error(`fal submit ${submitRes.status}: ${submitText.slice(0, 300)}`);
    }

    const { request_id, status_url, response_url } = JSON.parse(submitText);
    console.log(`🔄 [fal] request_id: ${request_id}`);

    const start = Date.now();
    while (Date.now() - start < MAX_WAIT_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      const statusRes = await fetch(status_url, {
        headers: { Authorization: `Key ${FAL_KEY}` },
      });
      // Сетевой сбой при опросе — не повод хоронить задание: следующая
      // итерация спросит снова, время ограничено общим таймаутом.
      if (!statusRes.ok) {
        console.warn(`[fal] опрос статуса ${statusRes.status}`);
        continue;
      }

      const status = await statusRes.json();
      console.log(`⏳ [fal] ${status.status}`);

      if (status.status === "FAILED") {
        throw new Error(`fal FAILED: ${JSON.stringify(status.error || status)}`);
      }

      if (status.status !== "COMPLETED") continue;

      const resultRes = await fetch(response_url, {
        headers: { Authorization: `Key ${FAL_KEY}` },
      });
      const resultText = await resultRes.text();
      if (!resultRes.ok) {
        throw new Error(`fal result ${resultRes.status}: ${resultText.slice(0, 300)}`);
      }

      const result = JSON.parse(resultText);
      const urls = (result.images || result.output?.images || []).map((img) =>
        typeof img === "string" ? img : img.url,
      );

      if (urls.length === 0) {
        throw new Error(`fal COMPLETED, но images пустой: ${resultText.slice(0, 300)}`);
      }

      // Скачиваем здесь, а не в воркере: провайдеры отдают наружу один и
      // тот же тип — готовые буферы. OpenAI ссылок не даёт вовсе, и
      // воркеру пришлось бы знать, у кого что.
      const images = await Promise.all(
        urls.map(async (url) => {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`fal скачивание ${res.status}`);
          return Buffer.from(await res.arrayBuffer());
        }),
      );

      return { requestId: request_id, images, ext: "jpg" };
    }

    throw new Error("fal: таймаут 3 минуты");
  },
};

export default falProvider;
