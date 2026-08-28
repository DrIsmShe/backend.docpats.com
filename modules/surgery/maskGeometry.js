// modules/surgery/maskGeometry.js
//
// Геометрия маски: анализ, кроп зоны правки и обратная сборка кадра.
//
// ЗАЧЕМ ЭТОТ ФАЙЛ ПОЯВИЛСЯ. Симуляция обязана показывать ТОГО ЖЕ пациента.
// Обещаниями в промте («identity preserved») этого не добиться: для модели
// это просто слова, и при малейшем поводе она рисует другого человека —
// вплоть до смены пола. Поэтому сохранность кадра здесь обеспечивается
// арифметикой, а не уговорами: то, что врач не закрасил, берётся из
// исходного файла попиксельно и не проходит через модель вообще.
//
// Второе назначение — разрешение. Мешки под глазами занимают 2-3% кадра.
// Отдавая модели весь снимок, мы отдаём под зону интереса 2-3% её
// разрешения, и результат выходит мыльным пятном. Кроп вокруг маски с
// запасом контекста поднимает эффективное разрешение зоны в разы.

import sharp from "sharp";

// Кратность стороны. FLUX работает с сеткой 16 px; отдавая некратный
// размер, мы отдаём решение о ресайзе провайдеру и теряем контроль над
// геометрией — а обратная сборка требует точного совпадения.
const GRID = 16;

const roundTo = (v, grid = GRID) => Math.max(grid, Math.round(v / grid) * grid);

/**
 * Доля закрашенного и границы зоны правки.
 *
 * Считается на уменьшенной копии: bbox с точностью до пары пикселей нам
 * достаточно (дальше всё равно идёт padding), а полноразмерный проход по
 * снимку 3264×2448 — это 8 млн итераций на каждую симуляцию.
 *
 * @returns {{paintedPct:number, bbox:{left:number,top:number,width:number,height:number}|null,
 *            width:number, height:number}}
 */
export async function analyzeMask(maskBuffer, photoWidth, photoHeight) {
  const meta = await sharp(maskBuffer).metadata();

  // Приводим к системе координат фотографии сразу: дальше все расчёты
  // ведутся в пикселях оригинала, и смешивать две сетки нельзя.
  const SCAN = 512;
  const scale = Math.min(1, SCAN / Math.max(photoWidth, photoHeight));
  const sw = Math.max(1, Math.round(photoWidth * scale));
  const sh = Math.max(1, Math.round(photoHeight * scale));

  const { data } = await sharp(maskBuffer)
    .resize(sw, sh, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let painted = 0;
  let minX = sw;
  let minY = sh;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (data[y * sw + x] > 127) {
        painted++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const paintedPct = (painted / (sw * sh)) * 100;

  if (maxX < 0) {
    return { paintedPct: 0, bbox: null, width: meta.width, height: meta.height };
  }

  const k = 1 / scale;
  const bbox = {
    left: Math.floor(minX * k),
    top: Math.floor(minY * k),
    width: Math.ceil((maxX - minX + 1) * k),
    height: Math.ceil((maxY - minY + 1) * k),
  };

  return { paintedPct, bbox, width: meta.width, height: meta.height };
}

/**
 * Окно, которое уйдёт в модель: bbox зоны правки плюс контекст вокруг.
 *
 * Контекст обязателен. Без окружающей кожи, второго глаза и линии скулы
 * модель не понимает, во что вписывать результат, и рисует правдоподобный
 * фрагмент чужого лица. С запасом в полтора-два размера зоны — вписывает
 * в то, что видит.
 *
 * Окно всегда лежит внутри кадра и не меньше MIN_SIDE: слишком маленький
 * вход модель отрабатывает хуже, чем средний.
 */
export function planCrop(bbox, photoWidth, photoHeight, { padRatio = 1.6 } = {}) {
  if (!bbox) return null;

  // Нижняя граница стороны — чтобы не отдавать модели марку почтовую, но
  // и без апскейла мелких снимков: на фото 452×679 окно в 512 px просто не
  // помещается, и жёсткая константа тут молча ломала бы расчёт.
  const minSide = Math.min(384, Math.floor(Math.min(photoWidth, photoHeight) * 0.5));

  // Окно считается по каждой оси отдельно: зона правки бывает сильно
  // вытянутой (полоска под нижними веками — 300×40), и подгонять такую под
  // квадрат значило бы раздуть окно до половины кадра, потеряв ровно то
  // разрешение, ради которого кроп и делается.
  //
  // Окно ОБЯЗАНО целиком содержать зону: срезанный край маски остался бы
  // необработанным, и врач увидел бы правку, обрывающуюся по невидимой
  // границе.
  const fit = (want, limit) =>
    Math.min(roundTo(want), Math.floor(limit / GRID) * GRID, limit);

  let width = fit(Math.max(minSide, bbox.width * padRatio), photoWidth);
  let height = fit(Math.max(minSide, bbox.height * padRatio), photoHeight);
  width = Math.max(width, Math.min(roundTo(bbox.width), photoWidth));
  height = Math.max(height, Math.min(roundTo(bbox.height), photoHeight));

  // Квадрат всё же предпочтительнее — но только когда он не съедает кадр.
  const square = Math.min(Math.max(width, height), photoWidth, photoHeight);
  if ((square * square) / (photoWidth * photoHeight) <= 0.6) {
    width = fit(square, photoWidth);
    height = fit(square, photoHeight);
  }

  const cx = bbox.left + bbox.width / 2;
  const cy = bbox.top + bbox.height / 2;
  const left = Math.max(0, Math.min(Math.round(cx - width / 2), photoWidth - width));
  const top = Math.max(0, Math.min(Math.round(cy - height / 2), photoHeight - height));

  // Кроп теряет смысл, когда покрывает почти весь кадр: контекста он не
  // добавляет, а лишнюю пересборку — да.
  const coverage = (width * height) / (photoWidth * photoHeight);
  if (coverage > 0.75) return null;

  return { left, top, width, height };
}

/**
 * Сборка итогового кадра: оригинал + сгенерированный фрагмент по маске.
 *
 * Растушёвка края (blur по альфе) нужна, чтобы шов не читался полосой.
 * Радиус привязан к размеру зоны, а не к кадру: на маленькой области
 * широкий переход съел бы саму правку.
 *
 * @param {Buffer} originalBuffer  исходный снимок целиком
 * @param {Buffer} generatedBuffer результат модели (кроп или целый кадр)
 * @param {Buffer} maskBuffer      маска в размере фотографии, белое = править
 * @param {{left,top,width,height}|null} region  куда вставлять; null = весь кадр
 */
export async function compositeByMask(
  originalBuffer,
  generatedBuffer,
  maskBuffer,
  photoWidth,
  photoHeight,
  region = null,
) {
  const box = region || { left: 0, top: 0, width: photoWidth, height: photoHeight };

  // Модель могла вернуть свой размер — возвращаем к геометрии окна.
  const patchRgb = await sharp(generatedBuffer)
    .resize(box.width, box.height, { fit: "fill" })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer();

  const feather = Math.max(1.2, Math.min(box.width, box.height) * 0.012);

  const alpha = await sharp(maskBuffer)
    .resize(photoWidth, photoHeight, { fit: "fill" })
    .extract(box)
    .greyscale()
    .blur(feather)
    .raw()
    .toBuffer();

  const patchRgba = await sharp(patchRgb, {
    raw: { width: box.width, height: box.height, channels: 3 },
  })
    .joinChannel(alpha, { raw: { width: box.width, height: box.height, channels: 1 } })
    .png()
    .toBuffer();

  return sharp(originalBuffer)
    .composite([{ input: patchRgba, left: box.left, top: box.top, blend: "over" }])
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

export default { analyzeMask, planCrop, compositeByMask };
