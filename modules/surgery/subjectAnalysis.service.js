// modules/surgery/subjectAnalysis.service.js
//
// Кто на фотографии — одной строкой по-английски, для промта модели.
//
// ЗАЧЕМ. Модель изображений видит только то, что не закрыто маской, и
// достраивает остальное по тексту. Если в тексте написано «результат
// блефаропластики, клиническая фотография», а про человека — ничего, она
// берёт среднее по обучающей выборке: для пластической хирургии это
// мужчина 50-65 лет. Отсюда и смена пола на выходе: не сбой модели, а
// пустое место в запросе, которое она честно заполнила статистикой.
//
// Описание строится по САМОМУ СНИМКУ, а не по карте пациента. Так надёжнее
// (в карте пола и возраста может не быть вовсе, кейс бывает анонимным) и
// не требует расшифровки персональных данных ради промта.
//
// ВАЖНО ПРО ДАННЫЕ. Фрагмент снимка уходит в OpenAI — туда же, куда уже
// уходит текст запроса врача через promptCompiler. Нового вендора это не
// добавляет, но снимок лица — идентифицируемые медицинские данные, и
// основание для передачи нужно то же самое, что для самой генерации.
// Выключается переменной SUBJECT_ANALYSIS=off.

const MODEL = process.env.SUBJECT_ANALYSIS_MODEL || "gpt-4o-mini";
const ENDPOINT = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 20_000;

const SYSTEM = `You describe the person in a clinical photograph so that an inpainting model can regenerate part of the image without changing who the person is.

Output ONE line of English, comma-separated fragments, 25 words maximum, no sentences, no preamble.

Include, in this order: apparent sex, apparent age band, ethnicity / skin tone, hair colour and style, facial hair if any, eye colour if visible, lighting and background of the shot.

Never mention surgery, defects, beauty judgements or emotions. Never speculate about identity, name or health. If something is not visible, omit it rather than guess.

Example: woman, mid-30s, fair skin, brown hair pulled back, blue eyes, even studio lighting, plain light background`;

function key() {
  return (process.env.OPENAI_API_KEY || "").trim();
}

export function subjectAnalysisEnabled() {
  return (process.env.SUBJECT_ANALYSIS || "on").toLowerCase() !== "off" && Boolean(key());
}

// Один и тот же снимок врач прогоняет по нескольку раз подряд, меняя зону
// и формулировку. Описание человека при этом не меняется — платить за него
// каждый раз незачем.
const cache = new Map();
const CACHE_MAX = 200;

/**
 * @param {Buffer} imageBuffer  снимок целиком (не кроп: по кропу глаза
 *                              модель не определит ни пол, ни причёску)
 * @param {string} cacheKey     имя файла снимка
 * @returns {Promise<string>}   описание или "" при любой неудаче
 */
export async function describeSubject(imageBuffer, cacheKey = "") {
  if (!subjectAnalysisEnabled()) return "";
  if (cacheKey && cache.has(cacheKey)) return cache.get(cacheKey);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);

  try {
    const dataUri = `data:image/jpeg;base64,${imageBuffer.toString("base64")}`;

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key()}`,
        "Content-Type": "application/json",
      },
      signal: ac.signal,
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 80,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: "Describe the person in this clinical photograph." },
              { type: "image_url", image_url: { url: dataUri, detail: "low" } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[subjectAnalysis] HTTP ${res.status}: ${body.slice(0, 200)}`);
      return "";
    }

    const data = await res.json();
    const out = (data.choices?.[0]?.message?.content || "").trim().replace(/^["']|["']$/g, "");

    // Отказ модели («I'm sorry…») — не описание. Пустая строка честнее:
    // дальше по цепочке она просто не добавит ничего в промт.
    if (out.length < 8 || /^(i['’]m sorry|i cannot|unable to)/i.test(out)) return "";

    console.log(`👤 [subjectAnalysis] ${out}`);

    if (cacheKey) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(cacheKey, out);
    }
    return out;
  } catch (err) {
    console.warn(`[subjectAnalysis] ${err.name === "AbortError" ? "таймаут" : err.message}`);
    return "";
  } finally {
    clearTimeout(timer);
  }
}

export default describeSubject;
