#!/usr/bin/env node
// server/scripts/make-test-dicom.mjs
//
// Собирает тестовый DICOM, чтобы проверить разбор, обезличивание и отрисовку
// без скачивания чужих файлов:
//
//   npm run make:test-dicom              → ./test-scan.dcm (с личными данными)
//   npm run make:test-dicom -- clean     → без личных данных, для сравнения
//
// ЗАЧЕМ. Настоящие снимки скачивать долго, а половина архивов отдаёт сжатый
// JPEG2000, который мы намеренно отклоняем. Этот файл проверяет ровно то, что
// нужно проверить в первую очередь: читается ли DICOM, срабатывает ли
// предупреждение о личных данных в тегах, получается ли картинка.
//
// В файле НЕТ настоящих данных пациента: «IVANOV^IVAN» и номер карты выдуманы
// и лежат здесь именно для того, чтобы увидеть, как система на них реагирует.
//
// Что он НЕ проверяет: качество чтения анатомии. Здесь простой фантом —
// круг в квадрате. Для этого нужны настоящие снимки (ссылки в README ниже).

import fs from "node:fs";
import path from "node:path";

const withPhi = process.argv[2] !== "clean";
const outPath = path.resolve(process.argv[3] ?? (withPhi ? "./test-scan.dcm" : "./test-scan-clean.dcm"));

/* ─── Элементы DICOM (Explicit VR Little Endian) ─────────────────────── */

function elString(group, element, vr, value) {
  const bytes = Buffer.from(value, "latin1");
  const padded = bytes.length % 2 ? Buffer.concat([bytes, Buffer.from(" ")]) : bytes;
  const head = Buffer.alloc(8);
  head.writeUInt16LE(group, 0);
  head.writeUInt16LE(element, 2);
  head.write(vr, 4, 2, "latin1");
  head.writeUInt16LE(padded.length, 6);
  return Buffer.concat([head, padded]);
}

function elUint16(group, element, value) {
  const buf = Buffer.alloc(10);
  buf.writeUInt16LE(group, 0);
  buf.writeUInt16LE(element, 2);
  buf.write("US", 4, 2, "latin1");
  buf.writeUInt16LE(2, 6);
  buf.writeUInt16LE(value, 8);
  return buf;
}

function elPixels(pixels) {
  const head = Buffer.alloc(12);
  head.writeUInt16LE(0x7fe0, 0);
  head.writeUInt16LE(0x0010, 2);
  head.write("OW", 4, 2, "latin1");
  head.writeUInt16LE(0, 6);
  head.writeUInt32LE(pixels.length, 8);
  return Buffer.concat([head, pixels]);
}

/* ─── Фантом: круг «мягкой ткани» с полостью внутри ──────────────────── */

const SIZE = 256;
const pixels = Buffer.alloc(SIZE * SIZE * 2);
const c = SIZE / 2;

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const r = Math.hypot(x - c, y - c);
    // Значения в HU: воздух −1000, мягкая ткань ~40, кость ~700.
    // Хранятся как unsigned со сдвигом 1024 (RescaleIntercept = −1024).
    let hu;
    if (r > SIZE * 0.45) hu = -1000;            // воздух вокруг
    else if (r > SIZE * 0.42) hu = 700;         // «костное кольцо»
    else if (r < SIZE * 0.12) hu = -900;        // «полость» в центре
    else hu = 40;                                // «мягкая ткань»
    pixels.writeUInt16LE(Math.max(0, Math.min(4095, hu + 1024)), (y * SIZE + x) * 2);
  }
}

const meta = elString(0x0002, 0x0010, "UI", "1.2.840.10008.1.2.1");
const metaLen = Buffer.alloc(12);
metaLen.writeUInt16LE(0x0002, 0);
metaLen.writeUInt16LE(0x0000, 2);
metaLen.write("UL", 4, 2, "latin1");
metaLen.writeUInt16LE(4, 6);
metaLen.writeUInt32LE(meta.length, 8);

// Выдуманные личные данные — именно для того, чтобы увидеть предупреждение.
const phi = withPhi
  ? Buffer.concat([
      elString(0x0010, 0x0010, "PN", "IVANOV^IVAN^IVANOVICH"),
      elString(0x0010, 0x0020, "LO", "MRN-778812"),
      elString(0x0010, 0x0030, "DA", "19780514"),
      elString(0x0008, 0x0050, "SH", "ACC-99120"),
      elString(0x0008, 0x0080, "LO", "CITY HOSPITAL 3"),
      elString(0x0008, 0x0090, "PN", "PETROV^PETR"),
    ])
  : Buffer.alloc(0);

const body = Buffer.concat([
  phi,
  elString(0x0008, 0x0060, "CS", "CT"),
  elString(0x0008, 0x1030, "LO", "TEST PHANTOM"),
  elString(0x0008, 0x103e, "LO", "AXIAL"),
  elString(0x0018, 0x0015, "CS", "PHANTOM"),
  elString(0x0018, 0x0050, "DS", "1.0"),
  elString(0x0018, 0x0060, "DS", "120"),
  elUint16(0x0028, 0x0002, 1),
  elString(0x0028, 0x0004, "CS", "MONOCHROME2"),
  elUint16(0x0028, 0x0010, SIZE),
  elUint16(0x0028, 0x0011, SIZE),
  elUint16(0x0028, 0x0100, 16),
  elUint16(0x0028, 0x0103, 0),
  elString(0x0028, 0x1052, "DS", "-1024"), // RescaleIntercept
  elString(0x0028, 0x1053, "DS", "1"),     // RescaleSlope
  elString(0x0028, 0x1050, "DS", "40"),    // WindowCenter — мягкотканное окно
  elString(0x0028, 0x1051, "DS", "400"),   // WindowWidth
  elPixels(pixels),
]);

const file = Buffer.concat([
  Buffer.alloc(128),
  Buffer.from("DICM", "latin1"),
  metaLen,
  meta,
  body,
]);

fs.writeFileSync(outPath, file);

console.log(`Готово: ${outPath}`);
console.log(`  ${Math.round(file.length / 1024)} КБ, ${SIZE}×${SIZE}, КТ-фантом, несжатый`);
console.log(
  withPhi
    ? "  В тегах ВЫДУМАННЫЕ личные данные — чтобы увидеть предупреждение системы."
    : "  Без личных данных — для сравнения.",
);
console.log("");
console.log("Проверить:");
console.log(`  npm run read:image -- ${path.basename(outPath)} ct`);
