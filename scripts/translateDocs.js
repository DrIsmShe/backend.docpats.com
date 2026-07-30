#!/usr/bin/env node
/**
 * server/scripts/translateDocs.js
 *
 * Переводит пользовательскую документацию с русского на en / tr / az / ar.
 *
 * Обобщает translateSimulationDocs.js, который умел ровно один каталог. Работа
 * та же, но раздел теперь аргумент, а не константа: корпус документации растёт
 * по одной странице на модуль, и заводить скрипт под каждую значило бы
 * копировать промпт, правила форматирования и логику повторов сорок раз. Одна
 * копия расходится молча — сорок расходятся гарантированно.
 *
 * Раскладка на диске:
 *   client/public/docs/<раздел>/ru.md         источник, пишет человек
 *   client/public/docs/<раздел>/{en,tr,az,ar}.md  перевод, пишет этот скрипт
 *   client/public/docs/<раздел>/notes.md      необязательно: словарь раздела
 *
 * Использование (из папки server/):
 *   node scripts/translateDocs.js                      все разделы, все языки
 *   node scripts/translateDocs.js for-doctors          один раздел
 *   node scripts/translateDocs.js simulation az ar     раздел и языки
 *   node scripts/translateDocs.js --force              переперевести всё
 *   node scripts/translateDocs.js --dry                показать план
 *
 * ПОВТОРНО НЕ ПЕРЕВОДИТ. В конец каждого перевода дописывается отпечаток
 * источника markdown-комментарием — в тексте он невидим, но по нему видно, что
 * русский оригинал с тех пор не менялся. Тот же приём, что у переводов кейсов
 * арены (sourceHash), и по той же причине: перевод неизменившегося текста —
 * это просто трата денег.
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = path.resolve(__dirname, "../..", "client", "public", "docs");

const SOURCE = "ru.md";
const NOTES = "notes.md";
const STAMP = "<!-- translated-from-ru:";

// Перевод — преобразование готового текста, а не рассуждение с нуля, но текст
// медицинский и уезжает к врачам: экономить на модели здесь неправильно.
// Переопределяется переменной окружения, не правкой кода.
const MODEL = process.env.DOCS_TRANSLATION_MODEL || "claude-opus-5";
const MAX_TOKENS = 32000;

/* ── языки ────────────────────────────────────────────────────────── */

const TARGETS = {
  en: {
    label: "English",
    notes: [
      "Use US medical English, formal register.",
      "Anatomical and clinical terms: use standard English medical terminology.",
    ],
  },
  tr: {
    label: "Turkish",
    notes: [
      "Use formal Turkish medical register, not colloquial.",
      "Anatomical and clinical terms: use Turkish medical terminology where it exists.",
    ],
  },
  az: {
    label: "Azerbaijani",
    notes: [
      "Use formal Azerbaijani medical register.",
      "Anatomical and clinical terms: use Azerbaijani medical terminology; keep the English term when the Azerbaijani equivalent is awkward.",
    ],
  },
  ar: {
    label: "Arabic",
    notes: [
      "Use Modern Standard Arabic (فصحى), formal medical register.",
      "Give the Arabic term with the English one in parentheses on first occurrence.",
      "The document is rendered right-to-left by the application — do NOT insert manual RTL markers.",
    ],
  },
};

const ALL_LANGS = Object.keys(TARGETS);

/* ── аргументы ────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const FORCE = argv.includes("--force");
const DRY = argv.includes("--dry");
const positional = argv.filter((a) => !a.startsWith("--"));
const langArgs = positional.filter((a) => ALL_LANGS.includes(a));
const sectionArgs = positional.filter((a) => !ALL_LANGS.includes(a));
const LANGS = langArgs.length ? langArgs : ALL_LANGS;

/* ── общие правила формата ────────────────────────────────────────── */

// Таблицы запрещены не из вкуса: просмотрщик документации собран без
// remark-gfm, и таблица отрендерится как строка с палками. Правило живёт
// здесь, потому что здесь его невозможно забыть.
const FORMAT_RULES = `FORMATTING RULES (violations break the application):
- Preserve ALL Markdown formatting exactly: headings, bold, italic, lists, code blocks, inline code, horizontal rules, links.
- Preserve structure: same section order, same heading levels, same number of paragraphs.
- Do NOT translate the contents of code blocks or inline code.
- Do NOT translate file paths, URLs, keyboard shortcuts, or HTML comments.
- Do NOT create Markdown tables (lines with | and ---). The renderer does not support them: use bullet lists instead, exactly as the source does.
- Keep product names as is: DocPats, Growth, Start, Pro.
- Keep abbreviations as is: HIPAA, GDPR, PHI, SOAP, API, PDF, PNG, JPG, WebP, CT, MRI, ECG.
- Keep every number, price, currency, percentage, and duration exactly as in the source.

OUTPUT:
- Return ONLY the translated Markdown. No preamble, no explanation, no fences around the whole document.
- Start directly with the first heading.`;

/* ── помощники ────────────────────────────────────────────────────── */

const sha1 = (text) => crypto.createHash("sha1").update(text).digest("hex");

/** Отпечаток источника из уже существующего перевода, если он там есть. */
function stampOf(translated) {
  const line = translated.split("\n").find((l) => l.startsWith(STAMP));
  return line ? line.slice(STAMP.length).replace("-->", "").trim() : null;
}

async function readIfExists(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

/** Разделы: явно заданные или все, где есть ru.md. */
async function resolveSections() {
  if (sectionArgs.length) return sectionArgs;
  const entries = await fs.readdir(DOCS_ROOT, { withFileTypes: true });
  const found = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (await readIfExists(path.join(DOCS_ROOT, e.name, SOURCE))) found.push(e.name);
  }
  return found.sort();
}

/* ── перевод одного файла ─────────────────────────────────────────── */

async function translateOnce(client, { text, lang, sectionNotes }) {
  const target = TARGETS[lang];

  const system = `You translate user-facing documentation for a medical software platform. The readers are practising physicians.

Target language: ${target.label} (code: ${lang}).

Translation requirements:
${[...target.notes, ...sectionNotes].map((n) => `- ${n}`).join("\n")}

${FORMAT_RULES}`;

  let dots = true;
  const timer = setInterval(() => dots && process.stdout.write("."), 5000);
  const startedAt = Date.now();

  try {
    // Поток, а не обычный запрос: у потока нет жёсткого таймаута на весь
    // ответ, а документ на несколько тысяч слов генерируется долго.
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [
        {
          role: "user",
          content: `Translate this Russian Markdown document to ${target.label}:\n\n---BEGIN DOCUMENT---\n${text}\n---END DOCUMENT---`,
        },
      ],
    });

    const message = await stream.finalMessage();
    clearInterval(timer);
    dots = false;

    if (message.stop_reason === "max_tokens") {
      throw new Error("перевод не поместился в лимит ответа");
    }
    const out = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!out) throw new Error("модель вернула пустой текст");

    const secs = Math.round((Date.now() - startedAt) / 1000);
    const u = message.usage ?? {};
    console.log(
      `\n    ${lang}: готово за ${secs} с · токенов ${u.input_tokens ?? "?"} → ${u.output_tokens ?? "?"}`,
    );
    return out;
  } catch (err) {
    clearInterval(timer);
    dots = false;
    console.log();
    throw err;
  }
}

async function translateWithRetry(client, params, attempts = 3) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await translateOnce(client, params);
    } catch (err) {
      last = err;
      if (i === attempts) break;
      const wait = 2000 * 2 ** (i - 1);
      console.log(`    ${params.lang}: ошибка (${err.message}), повтор через ${wait / 1000} с`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

/* ── основной проход ──────────────────────────────────────────────── */

async function main() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new Error("Нужен ANTHROPIC_API_KEY в .env сервера");
  }

  const sections = await resolveSections();
  if (!sections.length) {
    console.log(`В ${DOCS_ROOT} нет ни одного раздела с ${SOURCE}`);
    return;
  }

  console.log(
    `Разделы: ${sections.join(", ")}\nЯзыки: ${LANGS.join(", ")}\nМодель: ${MODEL}${FORCE ? "\nРежим: переперевести всё" : ""}${DRY ? "\nПРОБНЫЙ ПРОГОН\n" : "\n"}`,
  );

  const client = new Anthropic();
  const totals = { written: 0, skipped: 0, failed: 0 };

  for (const section of sections) {
    const dir = path.join(DOCS_ROOT, section);
    const source = await readIfExists(path.join(dir, SOURCE));
    if (!source) {
      console.log(`[${section}] нет ${SOURCE} — пропускаю`);
      continue;
    }

    // Словарь раздела: термины и имена, которые нельзя переводить как попало.
    const notesRaw = await readIfExists(path.join(dir, NOTES));
    const sectionNotes = notesRaw
      ? notesRaw.split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean)
      : [];

    const hash = sha1(source);
    console.log(`[${section}] ${source.length} символов${sectionNotes.length ? `, словарь: ${sectionNotes.length} правил` : ""}`);

    for (const lang of LANGS) {
      const file = path.join(dir, `${lang}.md`);
      const existing = await readIfExists(file);

      if (existing && !FORCE && stampOf(existing) === hash) {
        console.log(`    ${lang}: актуален, пропускаю`);
        totals.skipped += 1;
        continue;
      }
      if (DRY) {
        console.log(`    ${lang}: ${existing ? "устарел — перевёл бы заново" : "нет перевода — перевёл бы"}`);
        continue;
      }

      try {
        const translated = await translateWithRetry(client, { text: source, lang, sectionNotes });
        await fs.writeFile(file, `${translated}\n\n${STAMP} ${hash} -->\n`, "utf8");
        totals.written += 1;
      } catch (err) {
        // Один язык не должен останавливать остальные: отказ на арабском не
        // лишает врача турецкого.
        console.error(`    ${lang}: НЕ ПЕРЕВЕДЕНО — ${err.message}`);
        totals.failed += 1;
      }
    }
  }

  if (!DRY) {
    console.log(
      `\nГотово. Записано: ${totals.written}; актуальных: ${totals.skipped}; с ошибкой: ${totals.failed}`,
    );
  }
  if (totals.failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
