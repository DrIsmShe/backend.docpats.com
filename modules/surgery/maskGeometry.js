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
 * Заливка замкнутых контуров.
 *
 * ЗАЧЕМ. Кисть рисует линию, и врач нередко ОБВОДИТ зону, а не закрашивает
 * её: так размечают на бумаге и так же ведут руку мышью. Для модели это
 * означает противоположное — перерисовать надо ровно линию, а нос и
 * подглазья внутри неё оставить как есть. На выходе врач получает свой
 * запрос невыполненным и тонкую черту по нарисованному контуру: модель
 * добросовестно перерисовала единственное, что ей отдали.
 *
 * Отличить обводку от заливки нельзя — но можно сделать их равнозначными:
 * всё, что оказалось ВНУТРИ замкнутого контура, дорисовываем сами. Заливка
 * ищется от краёв кадра: непокрашенная область, до которой снаружи не
 * добраться, и есть внутренность.
 *
 * Незамкнутый контур останется линией — это честно: додумывать, где врач
 * хотел замкнуть, мы не вправе.
 */
export async function fillEnclosedAreas(maskBuffer, photoWidth, photoHeight) {
  // Работаем на уменьшенной копии: обход 8 млн пикселей на каждую симуляцию
  // не нужен, а точность границы всё равно теряется при обратном масштабе.
  const SCAN = 640;
  const scale = Math.min(1, SCAN / Math.max(photoWidth, photoHeight));
  const sw = Math.max(8, Math.round(photoWidth * scale));
  const sh = Math.max(8, Math.round(photoHeight * scale));

  const small = await sharp(maskBuffer)
    .resize(sw, sh, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();

  // Разлив снаружи внутрь по непокрашенному. Очередь на типизированном
  // массиве, а не рекурсия: стек на 400 тысячах пикселей не переживёт.
  const outside = new Uint8Array(sw * sh);
  const queue = new Int32Array(sw * sh);
  let head = 0;
  let tail = 0;

  const push = (i) => {
    if (!outside[i] && small[i] <= 127) {
      outside[i] = 1;
      queue[tail++] = i;
    }
  };

  for (let x = 0; x < sw; x++) {
    push(x);
    push((sh - 1) * sw + x);
  }
  for (let y = 0; y < sh; y++) {
    push(y * sw);
    push(y * sw + sw - 1);
  }

  while (head < tail) {
    const i = queue[head++];
    const x = i % sw;
    const y = (i / sw) | 0;
    if (x > 0) push(i - 1);
    if (x < sw - 1) push(i + 1);
    if (y > 0) push(i - sw);
    if (y < sh - 1) push(i + sw);
  }

  let filled = 0;
  const result = Buffer.alloc(sw * sh);
  for (let i = 0; i < result.length; i++) {
    const isMask = small[i] > 127;
    const isHole = !isMask && !outside[i];
    if (isHole) filled++;
    result[i] = isMask || isHole ? 255 : 0;
  }

  // Внутренностей нет — контур не замкнут либо зона и так залита. Отдаём
  // исходную маску, чтобы не терять точность её краёв на пересэмплировании.
  if (filled === 0) return { mask: maskBuffer, filledPct: 0 };

  const mask = await sharp(result, { raw: { width: sw, height: sh, channels: 1 } })
    .resize(photoWidth, photoHeight, { fit: "fill" })
    .threshold(128)
    .png()
    .toBuffer();

  return { mask, filledPct: (filled / (sw * sh)) * 100 };
}

/**
 * Штрих это или зона: какая доля закрашенного переживает «сжатие» краёв.
 *
 * Прямой признак толщины. Линия в несколько пикселей исчезает целиком,
 * залитая область теряет только кайму. Габарит для этого не годится:
 * пологий штрих через полкадра плотно заполняет свой тонкий bbox и по
 * такому признаку неотличим от полоски под нижними веками.
 *
 * Сжатие приближаем размытием с высоким порогом — морфологической эрозии
 * в sharp нет, а результат для нашей задачи тот же: у тонкого следа после
 * размытия нигде не остаётся яркости выше порога.
 *
 * @returns {number} доля выжившего, 0..1
 */
export async function strokeSurvival(maskBuffer, photoWidth, photoHeight) {
  const radius = Math.max(2, Math.min(photoWidth, photoHeight) * 0.01);

  // КАЖДЫЙ ШАГ — ОТДЕЛЬНЫЙ ПРОХОД, и это не перестраховка. В sharp порядок
  // операций задан библиотекой, а не порядком вызовов: в одной цепочке
  // threshold применяется РАНЬШЕ blur, то есть сжатия не происходит вовсе.
  // А stats() и вовсе считается по ВХОДНОМУ изображению и операции
  // пайплайна игнорирует — цепочка blur().threshold().stats() возвращала
  // статистику исходной маски, и любой штрих выглядел полноценной зоной.
  const normalized = await sharp(maskBuffer)
    .resize(photoWidth, photoHeight, { fit: "fill" })
    .greyscale()
    .toBuffer();

  const blurred = await sharp(normalized).blur(radius).toBuffer();
  const eroded = await sharp(blurred).threshold(200).toBuffer();

  const before = await sharp(normalized).stats();
  const after = await sharp(eroded).stats();

  const paintedBefore = before.channels[0].mean;
  if (paintedBefore <= 0) return 0;
  return after.channels[0].mean / paintedBefore;
}

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
