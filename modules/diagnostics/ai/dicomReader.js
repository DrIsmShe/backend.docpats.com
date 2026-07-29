// server/modules/diagnostics/ai/dicomReader.js
//
// DICOM: разбор файла, обезличивание и превращение среза в картинку, которую
// может посмотреть модель.
//
// ГЛАВНОЕ ЗДЕСЬ — НЕ ПИКСЕЛИ, А PHI.
//
// В обычном JPEG врач видит глазами всё, что на нём есть, и его подтверждение
// «материалы обезличены» чего-то стоит. В DICOM имя пациента, дата рождения,
// номер карты и название учреждения лежат В ТЕГАХ — врач их не видит и
// подтверждает вслепую. Поэтому файл разбирается ДО отправки куда-либо, и
// система сама говорит, что именно в нём лежит.
//
// Наружу уходит ТОЛЬКО отрендеренный срез. Теги не пересылаются модели, не
// сохраняются в деле и не пишутся в журнал — в отчёте фигурируют лишь имена
// найденных полей, но не их значения.
//
// ЧТО НЕ ПОДДЕРЖИВАЕТСЯ И ПОЧЕМУ ОБ ЭТОМ ГОВОРИТСЯ ВСЛУХ. dicom-parser читает
// теги и несжатые пиксели, но не распаковывает JPEG2000/JPEG-LS/RLE. Часть
// томографов пишет именно так. Отрисовать такой файл «как получится» нельзя:
// искажённая картинка хуже отказа — по ней сделают вывод. Поэтому сжатый
// файл честно отклоняется с указанием синтаксиса.

import dicomParser from "dicom-parser";
import sharp from "sharp";

/** Теги, наличие которых означает, что файл не обезличен. */
const PHI_TAGS = [
  ["x00100010", "имя пациента"],
  ["x00100020", "идентификатор пациента"],
  ["x00100030", "дата рождения"],
  ["x00101040", "адрес пациента"],
  ["x00102154", "телефон пациента"],
  ["x00080050", "номер обращения (accession)"],
  ["x00080080", "название учреждения"],
  ["x00080090", "врач, направивший на исследование"],
  ["x00081050", "врач, выполнивший исследование"],
];

/** Несжатые синтаксисы: только их мы умеем отрисовать сами. */
const UNCOMPRESSED = new Set([
  "1.2.840.10008.1.2", // Implicit VR Little Endian
  "1.2.840.10008.1.2.1", // Explicit VR Little Endian
  "1.2.840.10008.1.2.2", // Explicit VR Big Endian
  "1.2.840.10008.1.2.1.99", // Deflated Explicit VR LE
]);

const COMPRESSED_NAMES = {
  "1.2.840.10008.1.2.4.50": "JPEG Baseline",
  "1.2.840.10008.1.2.4.51": "JPEG Extended",
  "1.2.840.10008.1.2.4.57": "JPEG Lossless",
  "1.2.840.10008.1.2.4.70": "JPEG Lossless SV1",
  "1.2.840.10008.1.2.4.80": "JPEG-LS Lossless",
  "1.2.840.10008.1.2.4.81": "JPEG-LS Lossy",
  "1.2.840.10008.1.2.4.90": "JPEG 2000 Lossless",
  "1.2.840.10008.1.2.4.91": "JPEG 2000",
  "1.2.840.10008.1.2.5": "RLE Lossless",
};

/** DICOM Modality → ключ модальности этого модуля. */
const MODALITY_MAP = {
  CT: "ct",
  MR: "mri",
  CR: "xray",
  DX: "xray",
  RG: "xray",
  MG: "xray",
  US: "us",
  ECG: "ecg",
  XA: "xray",
  RF: "xray",
  PT: "ct",
  NM: "ct",
  ES: "endoscopy",
  SM: "histology",
};

/** Похоже ли на DICOM: маркер "DICM" на 128-м байте. */
export function looksLikeDicom(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length > 132 &&
    buffer.toString("ascii", 128, 132) === "DICM"
  );
}

function str(dataSet, tag) {
  try {
    const v = dataSet.string(tag);
    return typeof v === "string" ? v.trim() : "";
  } catch {
    return "";
  }
}

function num(dataSet, tag, fallback = null) {
  try {
    const v = dataSet.floatString(tag);
    return Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Разбирает DICOM и отдаёт срез картинкой + отчёт о том, что в файле лежит.
 *
 * @param {Buffer} buffer
 * @returns {Promise<{png: Buffer, mimeType: string, modalityKey: string|null,
 *   study: object, phiFields: string[], notes: string[]}>}
 */
export async function readDicom(buffer) {
  if (!looksLikeDicom(buffer)) {
    throw new Error("Файл не похож на DICOM: нет маркера DICM");
  }

  let dataSet;
  try {
    dataSet = dicomParser.parseDicom(new Uint8Array(buffer));
  } catch (err) {
    throw new Error(`DICOM не разбирается: ${err.message}`);
  }

  // ── что в файле есть из личных данных ──
  // Значения НЕ возвращаются и никуда не пишутся — только названия полей.
  const phiFields = PHI_TAGS.filter(([tag]) => str(dataSet, tag)).map(([, label]) => label);

  const transferSyntax = str(dataSet, "x00020010") || "1.2.840.10008.1.2";
  if (!UNCOMPRESSED.has(transferSyntax)) {
    const name = COMPRESSED_NAMES[transferSyntax] ?? transferSyntax;
    const err = new Error(
      `Файл сжат (${name}) — распаковка такого DICOM пока не поддерживается. ` +
        `Выгрузите срез в JPEG/PNG из просмотрщика: прочитать его система сможет.`,
    );
    err.phiFields = phiFields;
    err.compressed = true;
    throw err;
  }

  const rows = dataSet.uint16("x00280010");
  const cols = dataSet.uint16("x00280011");
  const bitsAllocated = dataSet.uint16("x00280100") ?? 16;
  const pixelRepresentation = dataSet.uint16("x00280103") ?? 0; // 1 = signed
  const samplesPerPixel = dataSet.uint16("x00280002") ?? 1;
  const frames = parseInt(str(dataSet, "x00280008") || "1", 10) || 1;
  const pixelElement = dataSet.elements.x7fe00010;

  if (!rows || !cols || !pixelElement) {
    throw new Error("В файле нет пиксельных данных или размеров изображения");
  }
  if (samplesPerPixel !== 1) {
    throw new Error("Цветной DICOM (RGB) пока не поддерживается — выгрузите срез в PNG");
  }

  const notes = [];
  if (frames > 1) {
    notes.push(`в файле ${frames} кадров — прочитан первый`);
  }

  // ── пиксели → значения в единицах модальности (HU для КТ) ──
  const slope = num(dataSet, "x00281053", 1) ?? 1;
  const intercept = num(dataSet, "x00281052", 0) ?? 0;
  const count = rows * cols;
  const values = new Float32Array(count);

  if (bitsAllocated === 16) {
    const raw = pixelRepresentation === 1
      ? new Int16Array(buffer.buffer, buffer.byteOffset + pixelElement.dataOffset, count)
      : new Uint16Array(buffer.buffer, buffer.byteOffset + pixelElement.dataOffset, count);
    for (let i = 0; i < count; i++) values[i] = raw[i] * slope + intercept;
  } else if (bitsAllocated === 8) {
    const raw = new Uint8Array(buffer.buffer, buffer.byteOffset + pixelElement.dataOffset, count);
    for (let i = 0; i < count; i++) values[i] = raw[i] * slope + intercept;
  } else {
    throw new Error(`Не поддерживается разрядность ${bitsAllocated} бит`);
  }

  // ── окно ──
  // Берём окно из самого файла: его выставил тот, кто снимок готовил, и это
  // ближе к тому, что видел рентгенолог, чем любое наше умолчание. Если окна
  // нет — растягиваем по фактическому диапазону среза.
  let center = num(dataSet, "x00281050");
  let width = num(dataSet, "x00281051");
  let windowSource = "из файла";

  if (center == null || width == null || !width) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < count; i++) {
      if (values[i] < min) min = values[i];
      if (values[i] > max) max = values[i];
    }
    center = (min + max) / 2;
    width = Math.max(1, max - min);
    windowSource = "подобрано по диапазону среза";
    notes.push("в файле не задано окно просмотра — яркость подобрана автоматически");
  }

  const lo = center - width / 2;
  const gray = Buffer.allocUnsafe(count);
  for (let i = 0; i < count; i++) {
    const v = ((values[i] - lo) / width) * 255;
    gray[i] = v <= 0 ? 0 : v >= 255 ? 255 : v;
  }

  // MONOCHROME1 — инвертированная шкала (белое = плотное наоборот).
  if (str(dataSet, "x00280004") === "MONOCHROME1") {
    for (let i = 0; i < count; i++) gray[i] = 255 - gray[i];
  }

  const png = await sharp(gray, { raw: { width: cols, height: rows, channels: 1 } })
    .png()
    .toBuffer();

  const dicomModality = str(dataSet, "x00080060");

  return {
    png,
    mimeType: "image/png",
    modalityKey: MODALITY_MAP[dicomModality] ?? null,
    // Технические данные исследования — без единого личного поля.
    study: {
      modality: dicomModality || "не указана",
      bodyPart: str(dataSet, "x00180015"),
      studyDescription: str(dataSet, "x00081030"),
      seriesDescription: str(dataSet, "x0008103e"),
      sliceThickness: str(dataSet, "x00180050"),
      kvp: str(dataSet, "x00180060"),
      rows,
      cols,
      frames,
      window: `${Math.round(center)} / ${Math.round(width)} (${windowSource})`,
    },
    phiFields,
    notes,
  };
}

/**
 * Технические данные исследования — строкой для подсказки модели.
 *
 * Личных полей здесь нет и быть не может: в study они не попадают вовсе.
 */
export function describeDicomStudy(study) {
  return [
    `Модальность по тегу DICOM: ${study.modality}.`,
    study.bodyPart ? `Область: ${study.bodyPart}.` : null,
    study.studyDescription ? `Исследование: ${study.studyDescription}.` : null,
    study.seriesDescription ? `Серия: ${study.seriesDescription}.` : null,
    study.sliceThickness ? `Толщина среза: ${study.sliceThickness} мм.` : null,
    `Матрица: ${study.cols}×${study.rows}. Окно: ${study.window}.`,
    study.frames > 1 ? `В файле ${study.frames} кадров, показан первый.` : null,
    "Это ОДИН срез из серии, а не исследование целиком.",
  ]
    .filter(Boolean)
    .join(" ");
}
