#!/usr/bin/env node
// server/scripts/read-image.mjs
//
// Прочитать снимок моделью прямо из командной строки:
//
//   npm run read:image -- C:\путь\к\снимку.jpg ct
//   npm run read:image -- ./снимок.png xray "жалобы на одышку"
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ИНСТРУМЕНТ. Проверять чтение снимков через интерфейс — это
// проверять сразу три вещи: модель, сервер и клиент. Когда результат не
// нравится, непонятно, какое из трёх звеньев виновато. Здесь работает только
// модель: файл читается с диска и уходит тем же кодом, что и при загрузке
// врачом (ai/imageStudyReader.js), а на экран печатается ровно то, что попадёт
// в дело.
//
// Снимок никуда не сохраняется — как и в самом модуле.

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const [filePath, modalityKey = "xray", ...hintParts] = process.argv.slice(2);

if (!filePath) {
  console.error(
    [
      "Укажите файл:",
      "  npm run read:image -- <файл> [модальность] [подсказка]",
      "",
      "Модальности с чтением изображений: ct, mri, xray, us, ecg, endoscopy, histology",
      "Пример: npm run read:image -- ./кт-пазух.jpg ct",
    ].join("\n"),
  );
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  console.error(`Файл не найден: ${filePath}`);
  process.exit(1);
}

const ext = path.extname(filePath).toLowerCase();
const mimeType = MIME[ext];
if (!mimeType) {
  console.error(`Не поддерживаемый формат: ${ext}. Нужен ${Object.keys(MIME).join(", ")}`);
  process.exit(1);
}

// Реестр модальностей — ради checklist, по которому модель ведёт осмотр.
await import("../modules/diagnostics/index.js");
const { getModality, supportsImages } = await import(
  "../modules/diagnostics/core/services/registry.js"
);
const { readImageStudy, renderImageStudyText } = await import(
  "../modules/diagnostics/ai/imageStudyReader.js"
);

const modality = getModality(modalityKey);
if (!modality) {
  console.error(`Нет такой модальности: ${modalityKey}`);
  process.exit(1);
}
if (!supportsImages(modalityKey)) {
  console.error(
    `Модальность «${modality.title}» не читает изображения (capabilities: ${modality.capabilities.join(", ")}).`,
  );
  process.exit(1);
}

const buffer = fs.readFileSync(filePath);
const kb = Math.round(buffer.length / 1024);

console.log(`Файл:        ${path.basename(filePath)} (${kb} КБ, ${mimeType})`);
console.log(`Модальность: ${modality.title}`);
console.log(`Подпись:     ${modality.binaryNote}`);
console.log("");
console.log("Читаю…");
console.log("");

const started = Date.now();
let read;
try {
  read = await readImageStudy({
    buffer,
    mimeType,
    modality,
    hint: hintParts.join(" "),
  });
} catch (err) {
  console.error(`Не удалось прочитать: ${err.message}`);
  process.exit(1);
}

console.log("─".repeat(72));
console.log(renderImageStudyText(read));
console.log("─".repeat(72));
console.log("");
console.log(`Модель: ${read.model}   версия промпта: ${read.promptVersion}   ${Math.round((Date.now() - started) / 1000)} с`);
console.log(`Наблюдений: ${read.observations.length}   ограничений названо: ${read.limits.length}`);

// Самопроверка на то, ради чего вводились правила: описание не должно
// отрицать патологию. Если это когда-нибудь сломается — увидим сразу.
const text = renderImageStudyText(read);
if (/патологии не выявлено|патологии нет|без патологии|норма\b/i.test(text)) {
  console.log("");
  console.log("⚠ ВНИМАНИЕ: в описании есть отрицание патологии — это запрещено промптом.");
  console.log("  Сообщите об этом: правило нарушено, его нужно усиливать.");
}

process.exit(0);
