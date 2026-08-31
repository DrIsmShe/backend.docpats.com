// server/modules/surgicalPlan/services/planParser.service.js

/* ============================================================
   ПРОМТ ВРАЧА → ТИПИЗИРОВАННЫЙ ПЛАН
   ============================================================
   Единственное место, где в этом конвейере участвует языковая
   модель. Дальше по цепочке идут только числа: клиническая
   валидация, warp-движок, генерация текстуры.

   Почему разбор, а не генерация картинки напрямую по промту:
   свободный текст в генеративную модель даёт результат, который
   нельзя измерить, нельзя воспроизвести и нельзя поправить иначе
   как переписыванием промта. План — это контракт: врач видит, как
   его поняли, правит числа ползунками, и одинаковый план всегда
   даёт одинаковую геометрию.

   Модель отвечает ТОЛЬКО за раскладку текста по каталогу.
   Она не решает, допустима ли операция клинически — это делает
   planValidator.service.js детерминированным кодом.
   ============================================================ */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { ServiceUnavailableError, ValidationError } from "../../../common/utils/errors.js";
import { getCatalog } from "../catalog/index.js";
import { getPlanSchema } from "./planSchema.service.js";

const MODEL = "claude-opus-5";

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ServiceUnavailableError(
      "Разбор плана недоступен: не задан ANTHROPIC_API_KEY",
    );
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

/* ------------------------------------------------------------
   Каталог → компактное описание для модели

   Отдаём JSON, а не пересказ прозой: каталог и так структура,
   а пересказ пришлось бы синхронизировать руками при каждой
   правке. Убираем только то, что модели не нужно — en-подписи
   и служебные поля конфликтов (их проверяет валидатор).
   ------------------------------------------------------------ */
function catalogForPrompt(catalog) {
  return catalog.operations.map((op) => ({
    code: op.code,
    label: op.label.ru,
    description: op.description,
    params: Object.fromEntries(
      Object.entries(op.params).map(([name, spec]) => [
        name,
        spec.type === "enum"
          ? { type: "enum", options: spec.options }
          : { type: "number", unit: spec.unit, min: spec.min, max: spec.max },
      ]),
    ),
  }));
}

/* ------------------------------------------------------------
   Системный промт

   Держим его СТАБИЛЬНЫМ на весь каталог: он одинаков для всех
   запросов одной процедуры, поэтому ставим на него cache_control.
   Всё изменчивое — текст врача, измерения, пол пациента — уходит
   в messages, после точки кэширования.
   (Кэш включается от ~1024 токенов префикса; на маленьком каталоге
   выигрыша не будет, но и вреда тоже.)
   ------------------------------------------------------------ */
function buildSystemPrompt(catalog, preset) {
  const ops = JSON.stringify(catalogForPrompt(catalog), null, 1);

  const measurements = JSON.stringify(
    preset.measurements.map((m) => ({
      code: m.code,
      label: m.label.ru,
      unit: m.unit,
      description: m.description,
    })),
    null,
    1,
  );

  return `Ты — ассистент пластического хирурга. Твоя единственная задача — разложить свободный текст врача по замкнутому каталогу операций. Ты НЕ даёшь медицинских рекомендаций и НЕ решаешь, что пациенту нужно.

ПРОЦЕДУРА: ${catalog.meta.label.ru}

КАТАЛОГ ОПЕРАЦИЙ (единственное, что может попасть в план):
${ops}

ИЗМЕРЕНИЯ ЭТОЙ ПРОЕКЦИИ (для понимания контекста; менять их напрямую нельзя):
${measurements}

ПРАВИЛА

1. Операции берутся только из каталога. Просьбу, которой в каталоге нет, клади в outOfScope с объяснением — не подменяй её похожей операцией.
2. Врач назвал величину явно («на 3 мм», «на 5 градусов») — source: "explicit", confidence высокая.
3. Величина не названа («немного приподнять», «убрать горбинку») — выбери клинически умеренное значение внутри границ каталога, поставь source: "inferred" и confidence ниже. ОБЯЗАТЕЛЬНО добавь в clarifications вопрос о конкретной величине с blocking: false.
4. Формулировка допускает разные операции («сделать нос аккуратнее») — не угадывай. Задай вопрос в clarifications с blocking: true и не клади операцию в план.
5. Знаки: положительное значение — увеличение/подъём/выдвижение, отрицательное — уменьшение/опускание/втягивание. «Опустить кончик» — это отрицательный delta_deg.
6. Величина за границами каталога — возьми ближайшую допустимую и обязательно скажи об этом в clarifications с blocking: true.
7. Одну просьбу не дублируй двумя операциями. Каждая операция входит в план не более одного раза.
8. rationale, summary, question, why, reason и request пиши на языке запроса врача.
9. Если измерения «до» переданы — используй их, чтобы оценить правдоподобие величины, и упомяни это в rationale. Если их нет, не выдумывай числа исходного состояния.

Ничего, кроме структуры плана, не возвращай.`;
}

/* ------------------------------------------------------------
   Изменчивая часть — запрос врача
   ------------------------------------------------------------ */
function buildUserContent({ prompt, measurements, patientGender, image }) {
  const parts = [];

  // Фото идёт ПЕРВЫМ: модель лучше работает, когда изображение
  // предшествует вопросу о нём.
  if (image) {
    parts.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mediaType,
        data: image.data,
      },
    });
  }

  const lines = [`ЗАПРОС ВРАЧА:\n${prompt}`];

  if (patientGender && patientGender !== "unknown") {
    lines.push(`\nПОЛ ПАЦИЕНТА: ${patientGender}`);
  }

  if (measurements && Object.keys(measurements).length > 0) {
    const rows = Object.entries(measurements)
      .map(([code, value]) => `- ${code}: ${value}`)
      .join("\n");
    lines.push(`\nИЗМЕРЕНИЯ «ДО»:\n${rows}`);
  } else {
    lines.push(
      "\nИЗМЕРЕНИЯ «ДО»: не переданы. Не ссылайся на конкретные исходные значения.",
    );
  }

  parts.push({ type: "text", text: lines.join("\n") });
  return parts;
}

/* ------------------------------------------------------------
   ОСНОВНАЯ ФУНКЦИЯ

   image — необязательный и по умолчанию НЕ передаётся вызывающим
   кодом. Фото пациента, ушедшее стороннему провайдеру, — вопрос
   не удобства, а BAA: включать его можно только там, где договор
   это покрывает. Разбор текста работает и без фото; фото лишь
   уточняет формулировки вроде «убрать эту горбинку».
   ------------------------------------------------------------ */
export async function parsePrompt({
  procedureCode,
  prompt,
  measurements = null,
  patientGender = "unknown",
  image = null,
}) {
  if (!prompt || !prompt.trim()) {
    throw new ValidationError("Пустой запрос врача", { i18n: "app.surgicalPlan.emptyRequest" });
  }

  const { catalog, preset } = getCatalog(procedureCode);
  const schema = getPlanSchema(catalog);

  let message;
  try {
    message = await getClient().messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // Разбор клинической формулировки — не классификация: модель
      // должна сопоставить просьбу с каталогом, проверить знаки и
      // границы, решить, чего не хватает.
      thinking: { type: "adaptive" },
      system: [
        {
          type: "text",
          text: buildSystemPrompt(catalog, preset),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: buildUserContent({
            prompt,
            measurements,
            patientGender,
            image,
          }),
        },
      ],
      output_config: { format: zodOutputFormat(schema) },
    });
  } catch (err) {
    // SDK разбирает ответ схемой на клиенте и на несовпадении бросает
    // AnthropicError. Это единственный барьер против выдуманной
    // операции: API держит только каркас ответа, значения ограничений
    // до него доезжают текстом в description (см. planSchema.service).
    // Отделяем этот случай от сетевого — он означает «модель ответила
    // не тем», а не «сервис недоступен», и повтор его чинит редко.
    if (/Failed to parse structured output/i.test(err.message || "")) {
      throw new ServiceUnavailableError(
        "Модель вернула план вне схемы каталога. Переформулируйте запрос ближе к терминам операций.",
      );
    }

    // Сеть, лимиты, 5xx — наружу как «сервис недоступен», а не 500:
    // врачу нужно понять, что стоит повторить, а не что всё сломалось.
    throw new ServiceUnavailableError(
      `Не удалось разобрать запрос: ${err.message}`,
    );
  }

  // Классификатор может отказать — это HTTP 200, а не исключение.
  if (message.stop_reason === "refusal") {
    throw new ValidationError(
      "Запрос отклонён политикой безопасности модели. Переформулируйте.",
      { category: message.stop_details?.category ?? null },
    );
  }

  if (!message.parsed_output) {
    throw new ServiceUnavailableError(
      "Модель вернула ответ, не соответствующий схеме плана",
    );
  }

  return {
    plan: message.parsed_output,
    // Метаданные разбора едут вместе с планом: без них нельзя
    // объяснить, почему вчерашний разбор того же текста отличался.
    meta: {
      model: MODEL,
      catalogVersion: catalog.meta.version,
      procedureCode: catalog.meta.code,
      imageUsed: Boolean(image),
      // cacheCreation отделён от cacheRead намеренно: если он не
      // сменяется на cacheRead от запроса к запросу, значит кэш
      // системного промта не срабатывает и каталог оплачивается
      // каждый раз заново.
      usage: {
        inputTokens: message.usage?.input_tokens ?? null,
        outputTokens: message.usage?.output_tokens ?? null,
        cacheCreationTokens: message.usage?.cache_creation_input_tokens ?? null,
        cacheReadTokens: message.usage?.cache_read_input_tokens ?? null,
      },
    },
  };
}

export default parsePrompt;
