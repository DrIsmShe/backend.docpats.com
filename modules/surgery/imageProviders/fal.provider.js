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

const MODEL = process.env.FAL_MODEL || "fal-ai/flux-pro/v1/fill";
const MAX_WAIT_MS = 180_000;
const POLL_INTERVAL_MS = 3_000;

function key() {
  return (process.env.FAL_KEY || "").trim();
}

function toDataUri(buf, mime) {
  return `data:${mime};base64,${buf.toString("base64")}`;
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

    const body = {
      image_url: toDataUri(imageBuffer, "image/jpeg"),
      mask_url: toDataUri(maskBuffer, "image/png"),
      prompt,
      negative_prompt: negativePrompt,
      num_images: numOutputs || 4,
      output_format: "jpeg",
      safety_tolerance: "5",
    };

    console.log(`📤 [fal] отправка, модель: ${MODEL}`);

    const submitRes = await fetch(`https://queue.fal.run/${MODEL}`, {
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
