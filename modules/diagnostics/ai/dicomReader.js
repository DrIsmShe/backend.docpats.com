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

// Теги, наличие которых означает, что файл не обезличен.
//
// Наружу отдаётся КЛЮЧ, а не русская подпись. Интерфейс работает на пяти
// языках, и врач на азербайджанском не должен получать «имя пациента» русской
// строкой с сервера. Русские подписи ниже — только для консольного
// инструмента и для подсказки модели, которая и так по-русски.
const PHI_TAGS = [
  ["x00100010", "patientName"],
  ["x00100020", "patientId"],
  ["x00100030", "birthDate"],
  ["x00101040", "patientAddress"],
  ["x00102154", "patientPhone"],
  ["x00080050", "accession"],
  ["x00080080", "institution"],
  ["x00080090", "referringPhysician"],
  ["x00081050", "performingPhysician"],
];

/** Русские подписи ключей PHI — для консоли и журнала, не для интерфейса. */
export const PHI_LABELS_RU = {
  patientName: "имя пациента",
  patientId: "идентификатор пациента",
  birthDate: "дата рождения",
  patientAddress: "адрес пациента",
  patientPhone: "телефон пациента",
  accession: "номер обращения (accession)",
  institution: "название учреждения",
  referringPhysician: "врач, направивший на исследование",
  performingPhysician: "врач, выполнивший исследование",
};

// Сколько кадров показывать из многокадрового файла. Двенадцать — компромисс:
// сетка 4×3 читаема, каждый кадр остаётся крупным, объём запроса разумный.
// Больше кадров означало бы мельче картинку — то есть видно меньше, а не больше.
const MAX_TILES = 12;

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
  const phiFields = PHI_TAGS.filter(([tag]) => str(dataSet, tag)).map(([, key]) => key);

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

  if (bitsAllocated !== 8 && bitsAllocated !== 16) {
    throw new Error(`Не поддерживается разрядность ${bitsAllocated} бит`);
  }

  const notes = [];
  const count = rows * cols;
  const bytesPerFrame = count * (bitsAllocated / 8);
  const slope = num(dataSet, "x00281053", 1) ?? 1;
  const intercept = num(dataSet, "x00281052", 0) ?? 0;

  /** Значения одного кадра в единицах модальности (HU для КТ). */
  const frameValues = (frameIndex) => {
    const offset = buffer.byteOffset + pixelElement.dataOffset + frameIndex * bytesPerFrame;
    const out = new Float32Array(count);
    const raw =
      bitsAllocated === 16
        ? pixelRepresentation === 1
          ? new Int16Array(buffer.buffer, offset, count)
          : new Uint16Array(buffer.buffer, offset, count)
        : new Uint8Array(buffer.buffer, offset, count);
    for (let i = 0; i < count; i++) out[i] = raw[i] * slope + intercept;
    return out;
  };

  // Сколько кадров реально лежит в файле. Заголовок иногда врёт (обрезанная
  // выгрузка), поэтому верим меньшему из заявленного и фактического: чтение за
  // границей буфера — это не «немного мусора», а падение процесса.
  const availableFrames = Math.max(
    1,
    Math.min(frames, Math.floor(pixelElement.length / bytesPerFrame)),
  );
  if (availableFrames < frames) {
    notes.push(`заявлено ${frames} кадров, фактически в файле ${availableFrames}`);
  }

  // ── какие кадры показать ──
  //
  // Отправить модели все триста срезов нельзя и незачем: это дорого, не
  // помещается и не помогает — связать триста отдельных картинок в одно
  // исследование она всё равно не может. Берём равномерную выборку по всей
  // серии: так видна динамика картины сверху вниз, а не одна произвольная
  // плоскость.
  //
  // Выборка — НЕ замена пролистыванию. Находка между выбранными срезами в неё
  // не попадёт, и об этом сказано и врачу (notes), и модели (описание).
  const picked = [];
  if (availableFrames <= MAX_TILES) {
    for (let i = 0; i < availableFrames; i++) picked.push(i);
  } else {
    for (let t = 0; t < MAX_TILES; t++) {
      picked.push(Math.round((t * (availableFrames - 1)) / (MAX_TILES - 1)));
    }
  }

  // Окно считаем по СРЕДНЕМУ кадру серии: на краях часто пусто (воздух над
  // головой, стол под пациентом), и подобранная по ним яркость сделала бы
  // середину нечитаемой.
  const values = frameValues(picked[Math.floor(picked.length / 2)]);

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
  const invert = str(dataSet, "x00280004") === "MONOCHROME1";

  /** Кадр → 8-битная серая картинка по общему для всей серии окну. */
  const toGray = (vals) => {
    const gray = Buffer.allocUnsafe(count);
    for (let i = 0; i < count; i++) {
      const v = ((vals[i] - lo) / width) * 255;
      const b = v <= 0 ? 0 : v >= 255 ? 255 : v;
      // MONOCHROME1 — инвертированная шкала: без этого плотное и воздушное
      // меняются местами и снимок читается наизнанку.
      gray[i] = invert ? 255 - b : b;
    }
    return gray;
  };

  let png;
  let layout = null;

  if (picked.length === 1) {
    png = await sharp(toGray(values), { raw: { width: cols, height: rows, channels: 1 } })
      .png()
      .toBuffer();
  } else {
    // Сетка кадров одной картинкой. Так модель видит серию целиком и может
    // сказать «изменение прослеживается с 40-го по 70-й срез», а не описывать
    // одну плоскость. Отправлять двенадцать отдельных изображений было бы и
    // дороже, и хуже: между собой она их не свяжет.
    const gridCols = Math.min(4, picked.length);
    const gridRows = Math.ceil(picked.length / gridCols);
    const tileW = Math.min(cols, Math.max(160, Math.floor(1600 / gridCols)));
    const tileH = Math.max(1, Math.round((rows * tileW) / cols));

    const tiles = await Promise.all(
      picked.map((f) =>
        sharp(toGray(frameValues(f)), { raw: { width: cols, height: rows, channels: 1 } })
          .resize(tileW, tileH, { fit: "fill" })
          .png()
          .toBuffer(),
      ),
    );

    // Номера кадров подписаны прямо на сетке: без них модель не сможет
    // сослаться на конкретный срез, и её «выше по серии» будет непроверяемым.
    const labels = picked
      .map((f, i) => {
        const x = (i % gridCols) * tileW + 6;
        const y = Math.floor(i / gridCols) * tileH + 22;
        return (
          `<text x="${x}" y="${y}" font-family="sans-serif" font-size="18" ` +
          `fill="#ffe680" stroke="#000" stroke-width="3" paint-order="stroke">${f + 1}</text>`
        );
      })
      .join("");

    png = await sharp({
      create: {
        width: tileW * gridCols,
        height: tileH * gridRows,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .composite([
        ...tiles.map((input, i) => ({
          input,
          left: (i % gridCols) * tileW,
          top: Math.floor(i / gridCols) * tileH,
        })),
        {
          input: Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${tileW * gridCols}" ` +
              `height="${tileH * gridRows}">${labels}</svg>`,
          ),
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();

    layout = { gridCols, gridRows, shown: picked.map((f) => f + 1) };
    notes.push(
      `из ${availableFrames} кадров показаны ${picked.length} равномерно по серии ` +
        `(№ ${picked.map((f) => f + 1).join(", ")}) — находка между выбранными ` +
        `срезами в выборку не попадёт`,
    );
  }

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
      frames: availableFrames,
      layout,
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
  const grid = study.layout;

  // Сетку срезов обязательно назвать сеткой. Иначе модель примет двенадцать
  // плиток за одну картинку и опишет несуществующую анатомию — «двенадцать
  // округлых образований» вместо двенадцати срезов одной головы.
  const framing = grid
    ? [
        `Это НЕ одна картинка, а СЕТКА ${grid.gridCols}×${grid.gridRows} из ${grid.shown.length} срезов`,
        `одной серии (всего в файле ${study.frames}), выбранных равномерно сверху вниз.`,
        `Читать по плиткам слева направо, сверху вниз; жёлтая цифра в углу плитки —`,
        `номер среза в серии (показаны № ${grid.shown.join(", ")}).`,
        `Ссылайтесь на находки по этим номерам.`,
        `Между показанными срезами есть непросмотренные: отсутствие изменений в выборке`,
        `НЕ означает их отсутствия в исследовании.`,
      ].join(" ")
    : study.frames > 1
      ? `В файле ${study.frames} кадров, показан первый. Это ОДИН срез из серии, а не исследование целиком.`
      : "Это ОДИН срез из серии, а не исследование целиком.";

  return [
    `Модальность по тегу DICOM: ${study.modality}.`,
    study.bodyPart ? `Область: ${study.bodyPart}.` : null,
    study.studyDescription ? `Исследование: ${study.studyDescription}.` : null,
    study.seriesDescription ? `Серия: ${study.seriesDescription}.` : null,
    study.sliceThickness ? `Толщина среза: ${study.sliceThickness} мм.` : null,
    `Матрица: ${study.cols}×${study.rows}. Окно: ${study.window}.`,
    framing,
  ]
    .filter(Boolean)
    .join(" ");
}
