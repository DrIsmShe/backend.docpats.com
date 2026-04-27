#!/usr/bin/env node
/**
 * server/scripts/translateSimulationDocs.js
 *
 * Переводит RU markdown инструкции на EN/TR/AZ/AR через Claude API.
 * Читает: client/public/docs/simulation/ru.md
 * Пишет:  client/public/docs/simulation/{en|tr|az|ar}.md
 *
 * Использование (из папки server/):
 *   node scripts/translateSimulationDocs.js         # все 4 языка
 *   node scripts/translateSimulationDocs.js en      # только один
 *   node scripts/translateSimulationDocs.js tr az   # только указанные
 *
 * ИЗМЕНЕНИЯ от предыдущей версии:
 * — Streaming API вместо sync (не ломается на больших ответах/долгих запросах)
 * — Таймаут 10 минут (TR/AZ/AR генерируются медленнее EN из-за токенизации)
 * — Progress-индикатор: выводит ... каждые 5 секунд ожидания
 * — Retry с exponential backoff при сетевых ошибках (3 попытки)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const DOCS_DIR = path.join(
  PROJECT_ROOT,
  "client",
  "public",
  "docs",
  "simulation",
);
const SOURCE_FILE = path.join(DOCS_DIR, "ru.md");

const TARGETS = {
  en: {
    label: "English",
    notes: [
      "Use US medical English, formal register.",
      "Keep 'Surgical Simulation' as proper product name.",
      "Technical terms: 'warp', 'liquify', 'control points', 'RBF', 'radius', 'strength' — keep in English as is.",
      "Anatomical terms: use standard English medical terms.",
      "Do NOT translate code blocks, file paths, keyboard shortcuts.",
    ],
  },
  tr: {
    label: "Turkish",
    notes: [
      "Use formal Turkish medical register (not colloquial).",
      "Product name 'Surgical Simulation' → 'Cerrahi Simülasyon' is acceptable.",
      "Technical terms may stay in English with Turkish descriptions.",
      "Anatomical terms — use Turkish medical terminology where exists.",
      "Do NOT translate code blocks, file paths, keyboard shortcuts.",
    ],
  },
  az: {
    label: "Azerbaijani",
    notes: [
      "Use formal Azerbaijani medical register.",
      "Product name 'Surgical Simulation' → 'Cərrahi Simulyasiya' is acceptable.",
      "Technical terms may stay in English when Azerbaijani equivalent is awkward.",
      "Anatomical terms — use Azerbaijani medical terminology.",
      "Do NOT translate code blocks, file paths, keyboard shortcuts.",
    ],
  },
  ar: {
    label: "Arabic",
    notes: [
      "Use Modern Standard Arabic (فصحى), formal medical register.",
      "Product name: 'المحاكاة الجراحية' or keep English in parentheses.",
      "Technical terms: provide Arabic + English in parentheses on first occurrence.",
      "Document rendered RTL — do NOT insert manual RTL markers.",
      "Anatomical terms — standard Arabic medical terminology.",
      "Do NOT translate code blocks, file paths, keyboard shortcuts.",
    ],
  },
};

/* ───────────────────────────────────────────────────────────────── */

async function translateDocument(anthropic, russianText, langCode) {
  const target = TARGETS[langCode];
  if (!target) throw new Error(`Unknown language: ${langCode}`);

  const systemPrompt = `You are a professional medical documentation translator specialized in plastic surgery and ENT. You translate user-facing software manuals for medical professionals.

Target language: ${target.label} (code: ${langCode}).

Translation requirements:
${target.notes.map((n) => `- ${n}`).join("\n")}

FORMATTING RULES (CRITICAL — violations will break the application):
- Preserve ALL Markdown formatting EXACTLY: headers, bold, italic, lists, code blocks, inline code, horizontal rules, links.
- Preserve structure: same number of paragraphs, same section order, same level of headers.
- Code blocks (triple backticks) and inline code (backticks) — DO NOT translate content.
- Keyboard shortcuts like Ctrl+Z — DO NOT translate.
- File paths like /docs/simulation/ — DO NOT translate.
- Product names: DocPats, Surgical Simulation, MediaPipe, Cloudflare R2 — keep as is.
- Technical abbreviations: JPG, PNG, WebP, PDF, RBF, HIPAA, GDPR, PHI, CRA, MVP, API — keep as is.
- DO NOT create markdown tables (lines with | and --- separator). Use bullet lists instead.

OUTPUT:
- Return ONLY the translated Markdown. No preamble, no explanation.
- Start directly with "#".`;

  const userPrompt = `Translate the following Russian Markdown document to ${target.label}:

---BEGIN DOCUMENT---
${russianText}
---END DOCUMENT---`;

  // Progress indicator — печатает точку каждые 5 сек ожидания
  let progressActive = true;
  const progressTimer = setInterval(() => {
    if (progressActive) process.stdout.write(".");
  }, 5000);

  const startTime = Date.now();

  try {
    /* ────────── Streaming вместо sync ──────────
       Stream API не имеет hard timeout'а на весь ответ — таймауты
       работают между chunk'ами. Для нашего случая стабильнее. */
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 16384,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    let collectedText = "";
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
      if (
        chunk.type === "content_block_delta" &&
        chunk.delta?.type === "text_delta"
      ) {
        collectedText += chunk.delta.text;
      } else if (chunk.type === "message_delta" && chunk.usage) {
        outputTokens = chunk.usage.output_tokens || outputTokens;
      } else if (chunk.type === "message_start" && chunk.message?.usage) {
        inputTokens = chunk.message.usage.input_tokens || 0;
      }
    }

    // Final message для правильных usage
    const finalMessage = await stream.finalMessage();
    inputTokens = finalMessage.usage?.input_tokens || inputTokens;
    outputTokens = finalMessage.usage?.output_tokens || outputTokens;

    progressActive = false;
    clearInterval(progressTimer);

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(
      `\n  [${langCode}] Done in ${elapsed}s. Tokens: ${inputTokens} in / ${outputTokens} out.`,
    );

    return collectedText.trim();
  } catch (err) {
    progressActive = false;
    clearInterval(progressTimer);
    console.log(); // newline after dots
    throw err;
  }
}

/* ────────── Retry с exponential backoff ────────── */
async function translateWithRetry(
  anthropic,
  russianText,
  langCode,
  maxAttempts = 3,
) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        console.log(
          `  [${langCode}] Retry attempt ${attempt}/${maxAttempts}...`,
        );
      }
      return await translateDocument(anthropic, russianText, langCode);
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const delayMs = 2000 * Math.pow(2, attempt - 1); // 2s, 4s, 8s
        console.log(
          `  [${langCode}] Error: ${err.message}. Waiting ${delayMs}ms before retry...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

/* ───────────────────────────────────────────────────────────────── */

async function main() {
  const args = process.argv.slice(2);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ ANTHROPIC_API_KEY not set in environment");
    process.exit(1);
  }

  console.log("📖 Reading source:", SOURCE_FILE);
  let russianText;
  try {
    russianText = await fs.readFile(SOURCE_FILE, "utf8");
  } catch (err) {
    console.error(`❌ Cannot read source file: ${err.message}`);
    process.exit(1);
  }
  console.log(`   Source size: ${russianText.length} chars`);

  /* ────────── Anthropic client с большим таймаутом ──────────
     600s = 10 min. Streaming сам нужно только для корректной
     обработки долгих ответов, но setup таймаута оставляем большой. */
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: 600000, // 10 минут
    maxRetries: 0, // отключаем built-in retry, у нас свой
  });

  const langsToTranslate =
    args.length > 0 ? args.filter((l) => TARGETS[l]) : Object.keys(TARGETS);

  if (langsToTranslate.length === 0) {
    console.error(
      `❌ No valid languages. Supported: ${Object.keys(TARGETS).join(", ")}`,
    );
    process.exit(1);
  }

  console.log(`🌍 Translating to: ${langsToTranslate.join(", ")}`);
  console.log();

  const results = { ok: [], failed: [] };

  for (const langCode of langsToTranslate) {
    console.log(
      `━━━ ${TARGETS[langCode]?.label || langCode} (${langCode}) ━━━`,
    );
    try {
      const translated = await translateWithRetry(
        anthropic,
        russianText,
        langCode,
      );

      const outPath = path.join(DOCS_DIR, `${langCode}.md`);
      await fs.writeFile(outPath, translated, "utf8");
      console.log(`  ✅ Saved: ${outPath}`);
      console.log(`  📄 ${translated.length} chars`);
      results.ok.push(langCode);
    } catch (err) {
      console.error(`  ❌ [${langCode}] Final error:`, err.message);
      results.failed.push(langCode);
    }
    console.log();
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━");
  console.log(
    `✨ Done. Success: ${results.ok.length}, Failed: ${results.failed.length}`,
  );
  if (results.ok.length > 0) {
    console.log(`   ✅ ${results.ok.join(", ")}`);
  }
  if (results.failed.length > 0) {
    console.log(`   ❌ ${results.failed.join(", ")}`);
    console.log(
      `   Retry failed ones: node scripts/translateSimulationDocs.js ${results.failed.join(" ")}`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
