// server/modules/surgicalPlan/services/planSchema.service.js

/* ============================================================
   СХЕМА ПЛАНА — СТРОИТСЯ ИЗ КАТАЛОГА
   ============================================================
   Схема не написана руками, а собирается из каталога операций.
   Иначе каталог и схема разъедутся: кто-то добавит операцию и
   забудет про схему, модель начнёт её возвращать, а разбор
   молча уронит поле.

   Дискриминированное объединение по code даёт две вещи разом:
   модель физически не может вернуть операцию, которой нет в
   каталоге, и параметры каждой операции типизированы своим
   набором, а не общим «мешком ключей».

   ВСЕ ПОЛЯ ОБЯЗАТЕЛЬНЫЕ — намеренно. Structured outputs куда
   надёжнее работают с полной схемой, а «ничего не нашлось»
   выражается пустым массивом, а не отсутствующим ключом.
   Пустой массив читается однозначно; отсутствие ключа — нет.

   ── ДВЕ ВЕРСИИ ZOD В ОДНОМ ПРОЕКТЕ ──

   Здесь импорт из "zod/v4", а в валидаторах запросов — из "zod".
   Это не небрежность: zodOutputFormat из SDK строит JSON Schema
   через zod v4 core и на схеме классического v3 падает с
   «Cannot read properties of undefined (reading 'def')».
   Пакет zod 3.25 отдаёт обе ветки, так что схема плана живёт на
   v4, а остальной проект не трогаем.

   ── ЧТО НА САМОМ ДЕЛЕ ПРОВЕРЯЕТ API ──

   Проверено на этой версии SDK: конвертер переносит значения
   ограничений в description, а не в ключи JSON Schema. То есть
   z.literal("tip_rotation") превращается в
     {"type":"string","description":"{const: \"tip_rotation\"}"},
   а .min(0.5).max(6) — в описание «{minimum: 0.5, maximum: 6}».

   Значит, API гарантирует только КАРКАС: типы полей, состав
   ключей, additionalProperties: false. Диапазоны и допустимые
   коды модель читает как текст и обычно соблюдает, но обязана
   этого не будет.

   Отсюда два следствия, и оба уже учтены:
   1. клиентский разбор zod в SDK — настоящий барьер против
      выдуманной операции (несовпадение = исключение, не тихий
      пропуск);
   2. диапазоны перепроверяет planValidator.service.js. Убрать
      ту проверку как «дублирующую схему» нельзя — она не
      дублирующая, она единственная.
   ============================================================ */

import { z } from "zod/v4";

/* ------------------------------------------------------------
   Параметр каталога → zod-тип
   ------------------------------------------------------------ */
function paramToZod(spec, opCode, paramName) {
  if (spec.type === "number") {
    let s = z.number();
    if (typeof spec.min === "number") s = s.min(spec.min);
    if (typeof spec.max === "number") s = s.max(spec.max);
    return s.describe(
      `${spec.label?.ru || paramName}${spec.unit ? `, ${spec.unit}` : ""}`,
    );
  }

  if (spec.type === "enum") {
    if (!Array.isArray(spec.options) || spec.options.length === 0) {
      throw new Error(
        `planSchema: ${opCode}.${paramName} — enum без options`,
      );
    }
    return z.enum(spec.options).describe(spec.label?.ru || paramName);
  }

  throw new Error(
    `planSchema: ${opCode}.${paramName} — неизвестный тип "${spec.type}"`,
  );
}

/* ------------------------------------------------------------
   Операция каталога → элемент объединения
   ------------------------------------------------------------ */
function operationToZod(op) {
  const shape = {};
  for (const [name, spec] of Object.entries(op.params)) {
    shape[name] = paramToZod(spec, op.code, name);
  }

  return z.strictObject({
    code: z.literal(op.code),
    params: z.strictObject(shape),

    // Обоснование пишется на языке запроса врача — план читает
    // тот же человек, который его продиктовал.
    rationale: z
      .string()
      .describe("Почему эта операция попала в план, одной фразой"),

    // Ключевое различие для доверия: врач должен видеть, где его
    // поняли буквально, а где система додумала за него.
    source: z
      .enum(["explicit", "inferred"])
      .describe(
        "explicit — величина названа врачом прямо; inferred — выведена из формулировки",
      ),

    confidence: z
      .number()
      .min(0)
      .max(1)
      .describe("Уверенность в разборе именно этой операции"),
  });
}

/* ------------------------------------------------------------
   Каталог → схема плана
   ------------------------------------------------------------ */
export function buildPlanSchema(catalog) {
  const variants = catalog.operations.map(operationToZod);

  if (variants.length === 0) {
    throw new Error("planSchema: пустой каталог операций");
  }

  // discriminatedUnion требует минимум две ветки; на каталоге из
  // одной операции падает — отдаём её напрямую.
  const operationSchema =
    variants.length === 1
      ? variants[0]
      : z.discriminatedUnion("code", variants);

  return z.strictObject({
    procedure: z.literal(catalog.meta.code),

    operations: z
      .array(operationSchema)
      .describe("Операции плана в порядке выполнения"),

    // То, чего в промте не хватило. Это не вежливость, а рабочий
    // инструмент: врач по этому списку видит, что именно система
    // не смогла из него вычитать, и дописывает одной строкой.
    clarifications: z
      .array(
        z.strictObject({
          question: z.string().describe("Вопрос врачу"),
          why: z.string().describe("Почему без ответа не обойтись"),
          blocking: z
            .boolean()
            .describe(
              "true — без ответа план исполнять нельзя; false — можно, но результат будет приблизительным",
            ),
        }),
      )
      .describe("Чего не хватило в запросе"),

    // Просьбы, которые каталог этой проекции не покрывает.
    // Молчать о них нельзя: врач решит, что его поняли.
    outOfScope: z
      .array(
        z.strictObject({
          request: z.string().describe("Что просил врач"),
          reason: z
            .string()
            .describe("Почему это вне возможностей текущей проекции"),
        }),
      )
      .describe("Что осталось за рамками каталога"),

    summary: z
      .string()
      .describe("План одной-двумя фразами, языком запроса врача"),
  });
}

/* ------------------------------------------------------------
   Кэш схем по коду процедуры

   Схему используют двое: разбор промта (отдаёт её модели) и
   перевалидация правок ползунками (проверяет ею тело запроса).
   Сборка zod-объекта и его перегон в JSON Schema заметно дороже
   чтения из карты, а каталог за время жизни процесса не меняется.
   ------------------------------------------------------------ */
const cache = new Map();

export function getPlanSchema(catalog) {
  if (!cache.has(catalog.meta.code)) {
    cache.set(catalog.meta.code, buildPlanSchema(catalog));
  }
  return cache.get(catalog.meta.code);
}

export default buildPlanSchema;
