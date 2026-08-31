// scripts/i18n-extract-module.mjs
//
// Готовит перевод сообщений одного модуля: по русскому тексту получает
// короткий код и переводы на четыре языка.
//
// Код придумывает модель, а не скрипт: «Шаблон отчёта не найден» должно
// стать reportTemplate.notFound, а не myClinic.msg47. Коды читают люди —
// по ним потом ищут, где сообщение показывается.
//
// Запуск: node scripts/i18n-extract-module.mjs <тексты.json> <префикс> <выход.json>

import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";

dotenv.config();

const [INPUT, PREFIX, OUTPUT] = process.argv.slice(2);
const BATCH = 25;
const client = new Anthropic({ timeout: 600_000 });

const texts = Object.keys(JSON.parse(fs.readFileSync(INPUT, "utf8")));
console.log(`Текстов: ${texts.length}`);

async function processBatch(chunk) {
  const prompt = `You are preparing i18n for a medical clinic management system.

For each Russian message below, produce:
  - "code": a short dot-separated identifier in English, lowerCamelCase segments,
    prefixed with "${PREFIX}.". Base it on MEANING, not on wording.
    Examples: ${PREFIX}.reportTemplate.notFound, ${PREFIX}.patient.notFound
  - "en", "az", "tr", "ar": translations of the message.

RULES:
- These are messages shown to doctors. Keep the tone neutral and professional.
- Preserve leading emoji (✅ ❌) exactly as in the original if present.
- Medical terminology must be precise.
- Return ONLY a JSON array, one object per input message, in the SAME ORDER:
  [{"ru": "...", "code": "...", "en": "...", "az": "...", "tr": "...", "ar": "..."}]
- No commentary, no markdown fences.

MESSAGES:
${JSON.stringify(chunk, null, 1)}`;

  const msg = await client.messages
    .stream({
      model: "claude-sonnet-4-5",
      max_tokens: 16000,
      messages: [{ role: "user", content: prompt }],
    })
    .finalMessage();

  if (msg.stop_reason === "max_tokens") throw new Error("ответ оборван");

  let text = msg.content[0].text.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const arr = JSON.parse(text);
  if (!Array.isArray(arr) || arr.length !== chunk.length) {
    throw new Error(`ожидалось ${chunk.length} записей, пришло ${arr?.length}`);
  }
  return arr;
}

const result = [];
for (let i = 0; i < texts.length; i += BATCH) {
  const chunk = texts.slice(i, i + BATCH);
  process.stdout.write(`  ${i + 1}-${i + chunk.length}… `);
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    try {
      result.push(...(await processBatch(chunk)));
      ok = true;
      console.log("готово");
    } catch (err) {
      console.log(`сбой (${err.message}), повтор`);
    }
  }
  if (!ok) throw new Error(`не удалось обработать пачку ${i}`);
}

// Коды обязаны быть уникальными: одинаковый код у двух разных сообщений
// молча склеит их в одно.
const seen = new Map();
for (const item of result) {
  let code = item.code;
  if (seen.has(code) && seen.get(code) !== item.ru) {
    let n = 2;
    while (seen.has(`${code}${n}`)) n += 1;
    code = `${code}${n}`;
    item.code = code;
  }
  seen.set(code, item.ru);
}

fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 1), "utf8");
console.log(`Записано: ${result.length} в ${OUTPUT}`);
