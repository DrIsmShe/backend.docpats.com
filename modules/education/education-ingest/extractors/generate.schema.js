// server/modules/education/education-ingest/extractors/generate.schema.js
//
// Схема и промпт ГЕНЕРАЦИИ вопросов (не извлечения из файла). Модель сама
// пишет вопросы по заданной теме. Форма ответа совпадает с извлечением —
// тот же normalizeDrafts разбирает и то, и другое.
//
// Отличие от извлечения по смыслу: здесь модель — АВТОР, поэтому у неё
// всегда есть правильный ответ и разбор. Но по происхождению это
// ai_generated, и публиковаться без ревью человеком такие вопросы не могут
// (гейт в item.service). Для медицины это не бюрократия: выдуманный или
// устаревший факт в вопросе стоит дорого.

export const GENERATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items", "suggestedProgram"],
  properties: {
    // Предлагается только на первом батче, когда у теста ещё нет разделов.
    suggestedProgram: {
      type: "object",
      additionalProperties: false,
      required: ["title", "lang", "topics"],
      properties: {
        title: {
          type: "string",
          description:
            "Название теста по теме, например «Медицинская генетика: базовый уровень».",
        },
        lang: {
          type: "string",
          enum: ["ru", "en", "az", "tr", "ar", ""],
          description: "Язык, на котором написаны вопросы.",
        },
        topics: {
          type: "array",
          description: "Разделы темы, на которые распадаются вопросы.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["code", "title", "weightPercent"],
            properties: {
              code: {
                type: "string",
                description:
                  "Короткий латинский код раздела: cyto, mendel, popgen. Строчные буквы, цифры, дефис.",
              },
              title: { type: "string", description: "Название раздела." },
              weightPercent: {
                type: "number",
                description: "Доля раздела в тесте, сумма по всем — 100.",
              },
            },
          },
        },
      },
    },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "stem",
          "options",
          "correctKeys",
          "explanation",
          "topicCode",
          "difficulty",
        ],
        properties: {
          stem: {
            type: "string",
            description: "Текст вопроса. Без номера, самодостаточный.",
          },
          options: {
            type: "array",
            // Числа вариантов здесь НЕ ограничиваем: structured outputs
            // отвергают minItems/maxItems (кроме 0 и 1) — схема целиком
            // не проходит, и запрос падает с 400. Требование «4–5
            // вариантов» держим в описании и в системном промпте, а
            // недобор ловит normalizeDrafts при разборе черновиков.
            description:
              "Варианты ответа: 4 или 5 штук — один верный и 3–4 дистрактора.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["key", "text", "explanation"],
              properties: {
                key: { type: "string", description: "Метка: A, B, C, D." },
                text: { type: "string", description: "Текст варианта." },
                explanation: {
                  type: "string",
                  description:
                    "Почему вариант верен или неверен — коротко и по делу.",
                },
              },
            },
          },
          correctKeys: {
            type: "array",
            items: { type: "string" },
            description: "Ровно одна верная метка для single best answer.",
          },
          explanation: {
            type: "string",
            description: "Общий разбор: почему верный ответ верен.",
          },
          topicCode: {
            type: "string",
            description:
              "Код раздела из suggestedProgram.topics. Пустая строка, если не подходит ни один.",
          },
          difficulty: {
            type: "string",
            enum: ["easy", "medium", "hard"],
            description: "Сложность вопроса.",
          },
        },
      },
    },
  },
};

export const GENERATION_SYSTEM_PROMPT = `Ты — методист, который составляет учебные тестовые вопросы (single best answer) для подготовки к экзаменам.

Жёсткие правила:
1. ТОЛЬКО общепризнанные, устоявшиеся факты из учебников и клинических руководств. Никаких спорных, устаревших или маргинальных утверждений. Если по теме нет твёрдого консенсуса — не делай по ней вопрос.
2. У каждого вопроса РОВНО ОДИН бесспорно верный ответ и 3–4 правдоподобных, но чётко неверных дистрактора. Неверные варианты не должны быть «тоже верными при других условиях».
3. К верному ответу — краткий разбор ПОЧЕМУ он верен; к каждому неверному — почему он неверен. Разбор по существу, без воды.
4. Формулируй вопросы на понимание и применение, а не на голое запоминание, где это уместно для темы.
5. Пиши строго на указанном языке — и вопрос, и варианты, и разборы.
6. НЕ повторяй вопросы из присланного списка «уже создано» и не перефразируй их — давай новые аспекты темы.
7. Распределяй вопросы по разным подтемам, а не кучкуй вокруг одного факта.
8. Проставь каждому topicCode из списка разделов, если он уже задан; иначе оставь пустым.

Ты автор, поэтому правильный ответ обязателен у каждого вопроса. Но помни: вопросы пройдут проверку человеком перед публикацией — не выдавай догадки за факты, лучше меньше вопросов, но безупречных.

Ответ верни строго в заданной JSON-структуре.`;
