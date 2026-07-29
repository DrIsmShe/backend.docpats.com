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
const raw = fs.readFileSync(filePath);

// DICOM опознаётся по маркеру внутри файла, а не по расширению: выгрузки из
// разных архивов приходят и как .dcm, и вообще без расширения.
const { looksLikeDicom, readDicom, describeDicomStudy, PHI_LABELS_RU } = await import(
  "../modules/diagnostics/ai/dicomReader.js"
);

// Сервер отдаёт ключи полей, чтобы интерфейс перевёл их на язык врача.
// В консоли переводим сами — здесь язык всегда русский.
const phiRu = (keys) => keys.map((k) => PHI_LABELS_RU[k] ?? k).join(", ");
const isDicom = looksLikeDicom(raw);

const mimeType = isDicom ? "application/dicom" : MIME[ext];
if (!mimeType) {
  console.error(
    `Не поддерживаемый формат: ${ext || "без расширения"}. ` +
      `Нужен ${Object.keys(MIME).join(", ")} или DICOM.`,
  );
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

// Для DICOM работаем с отрисованным срезом; для картинки — с самим файлом.
let buffer = raw;
let imageMime = mimeType;
let dicomHint = "";
let isSheet = false;

if (isDicom) {
  let dicom;
  try {
    dicom = await readDicom(raw);
  } catch (err) {
    console.error(`DICOM не прочитан: ${err.message}`);
    if (err.phiFields?.length) {
      console.error("");
      console.error(`⚠ ФАЙЛ НЕ ОБЕЗЛИЧЕН. В тегах: ${phiRu(err.phiFields)}.`);
    }
    process.exit(1);
  }
  buffer = dicom.png;
  imageMime = dicom.mimeType;
  dicomHint = describeDicomStudy(dicom.study);
  isSheet = Boolean(dicom.study.layout);

  console.log("── DICOM ──");
  console.log(`Модальность по тегу: ${dicom.study.modality}`);
  if (dicom.study.bodyPart) console.log(`Область:             ${dicom.study.bodyPart}`);
  console.log(`Матрица:             ${dicom.study.cols}×${dicom.study.rows}`);
  console.log(`Кадров в файле:      ${dicom.study.frames}`);
  if (isSheet) {
    const { gridCols, gridRows, shown } = dicom.study.layout;
    console.log(`Показано:            сетка ${gridCols}×${gridRows}, срезы № ${shown.join(", ")}`);
  }
  console.log(`Окно:                ${dicom.study.window}`);
  for (const n of dicom.notes) console.log(`Замечание:           ${n}`);

  // Только в этом инструменте: картинка кладётся на диск, чтобы её можно было
  // открыть и сравнить с тем, что написала модель. В самом модуле снимок
  // никуда не сохраняется — там в дело попадает только текст.
  const previewPath = `${filePath}.preview.png`;
  fs.writeFileSync(previewPath, dicom.png);
  console.log(`Картинка для глаз:   ${previewPath}`);
  console.log("");
  if (dicom.phiFields.length) {
    // Врач этих полей не видит: в DICOM они внутри файла, а не на картинке.
    console.log(`⚠ ФАЙЛ НЕ ОБЕЗЛИЧЕН. В тегах есть: ${phiRu(dicom.phiFields)}.`);
    console.log("  Значения не печатаются и модели не отправляются — уходит только срез.");
    console.log("");
  } else {
    console.log("Личных данных в тегах не найдено.");
    console.log("");
  }
}

const kb = Math.round(raw.length / 1024);

console.log(`Файл:        ${path.basename(filePath)} (${kb} КБ, ${mimeType})`);
console.log(`Модальность: ${modality.title}`);
// binaryNote написан про обычную картинку («читается одно изображение»). Для
// сетки срезов он уже неверен — печатать его здесь значило бы противоречить
// самому себе двумя строками выше.
console.log(
  isSheet
    ? `Подпись:     Читается ВЫБОРКА срезов серии одной сеткой. Полной серии, плотностей в HU и других окон у модели нет.`
    : `Подпись:     ${modality.binaryNote}`,
);
console.log("");
console.log("Читаю…");
console.log("");

const started = Date.now();
let read;
try {
  read = await readImageStudy({
    buffer,
    mimeType: imageMime,
    modality,
    hint: [dicomHint, hintParts.join(" ")].filter(Boolean).join(" "),
    sheet: isSheet,
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
