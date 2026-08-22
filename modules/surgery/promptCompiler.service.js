// modules/surgery/promptCompiler.service.js
//
// Перевод запроса врача в промт, который понимает модель изображений.
//
// ЗАЧЕМ ЭТО ВООБЩЕ НУЖНО. Врач пишет так, как думает: «уменьшить кончик
// носа, поднять на 10 градусов, убрать горбинку». Для FLUX Fill это
// бесполезный текст, и вот почему — три разные причины сразу:
//
//   1. Модель не выполняет ДЕЙСТВИЕ. Она заполняет выделенную область
//      изображением, СООТВЕТСТВУЮЩИМ описанию. «Уменьшить» относительно
//      чего — она не знает: исходного носа она в маске уже не видит.
//   2. Русский язык. FLUX обучен на английских подписях; русский текст
//      для него почти шум. Все восемь готовых промтов каталога написаны
//      по-английски именно поэтому, а не для красоты.
//   3. Градусы и миллиметры не значат ничего. Ни одна генеративная
//      модель изображений их не отрабатывает — это ограничение класса
//      моделей, а не недоделка.
//
// В сумме модель получает невнятный сигнал и рисует правдоподобный нос —
// какой получится. Врач видит «сделал наоборот», хотя модель просто не
// поняла задачу.
//
// Компилятор превращает намерение в ОПИСАНИЕ ЖЕЛАЕМОГО ВИДА на английском.
// Величины при этом не выбрасываются молча, а переводятся в качественную
// формулировку: «поднять на 10 градусов» → «slightly upturned tip».
// Обещать точность в градусах было бы враньём, а терять смысл — потерей.
//
// Пресеты каталога через компилятор НЕ проходят: они уже написаны как
// надо, и лишний вызов модели только добавил бы способ их испортить.
//
// При любой ошибке возвращаем исходный текст. Компиляция — улучшение, а
// не условие работы: из-за недоступности OpenAI не должна отваливаться
// генерация, за которую уже заплачено.

const MODEL = process.env.PROMPT_COMPILER_MODEL || "gpt-4o-mini";
const ENDPOINT = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 15_000;

const SYSTEM = `You rewrite a surgeon's free-form request into an image-generation prompt for an inpainting model (FLUX Fill / gpt-image-1).

The model does NOT perform actions. It fills a masked region with content matching your description. So describe the DESIRED APPEARANCE of the region after surgery, never the operation itself.

Rules:
- Output English only.
- COVER EVERY CHANGE THE SURGEON ASKED FOR. If the request lists three things, all three must appear in the output. Dropping one silently is the worst failure mode: the surgeon sees a result that ignores part of the request and cannot tell why.
- Describe the resulting anatomy as it should LOOK, not what to change. Not "reduce the hump" but "smooth straight nasal bridge without a dorsal hump".
- Numeric amounts (degrees, millimetres) cannot be honoured by image models. Convert them into qualitative wording: "raise 10 degrees" -> "slightly upturned tip". Never keep the number.
- Always preserve the person's identity, ethnicity, skin texture and lighting. Say so explicitly.
- Always end with photorealism cues: clinical medical photography, natural skin texture, photorealistic, high detail.
- Give EACH requested change its own fragment. Two changes to the same body part are still two fragments — "smaller tip" and "upturned tip" are different things and merging them loses one.
- One line, comma-separated fragments, no sentences, no quotes, no preamble.
- 40 words maximum.

Example.
Request (facelift): "убрать второй подбородок, подтянуть овал, чуть выдвинуть подбородок на 3 мм"
Output: defined jawline without submental fullness, lifted smooth facial contour, slightly more projected chin, identity ethnicity and skin texture preserved, clinical medical photography, natural skin texture, photorealistic, high detail`;

function key() {
  return (process.env.OPENAI_API_KEY || "").trim();
}

export function promptCompilerEnabled() {
  return Boolean(key());
}

/**
 * @param {string} text   что написал врач, на любом языке
 * @param {string} procedure  ключ процедуры — контекст для модели
 * @returns {Promise<{prompt: string, compiled: boolean, reason?: string}>}
 */
export async function compilePrompt(text, procedure = "") {
  const raw = String(text || "").trim();
  if (!raw) return { prompt: raw, compiled: false, reason: "пустой запрос" };

  const OPENAI_KEY = key();
  if (!OPENAI_KEY) {
    return { prompt: raw, compiled: false, reason: "нет OPENAI_API_KEY" };
  }

  // Таймаут обязателен: врач ждёт ответа на нажатие кнопки, и повисший
  // запрос к стороннему API читается как зависший интерфейс.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      signal: ac.signal,
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2, // стабильность важнее разнообразия
        max_tokens: 120,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: procedure
              ? `Procedure: ${procedure}\nSurgeon's request: ${raw}`
              : `Surgeon's request: ${raw}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[promptCompiler] HTTP ${res.status}: ${body.slice(0, 200)}`);
      return { prompt: raw, compiled: false, reason: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const out = data.choices?.[0]?.message?.content?.trim();

    // Пустой или подозрительно короткий ответ хуже исходного текста:
    // из «nose» модель изображений не сделает ничего осмысленного.
    if (!out || out.length < 10) {
      return { prompt: raw, compiled: false, reason: "пустой ответ модели" };
    }

    console.log(`🧩 [promptCompiler] "${raw.slice(0, 40)}…" → "${out.slice(0, 60)}…"`);
    return { prompt: out, compiled: true };
  } catch (err) {
    const reason = err.name === "AbortError" ? "таймаут" : err.message;
    console.warn(`[promptCompiler] ${reason}`);
    return { prompt: raw, compiled: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

export default compilePrompt;
