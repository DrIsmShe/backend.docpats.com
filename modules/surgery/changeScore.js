// modules/surgery/changeScore.js
//
// Насколько результат модели отличается от исходного снимка.
//
// ЗАЧЕМ. Модели редактирования недетерминированы: на одном и том же снимке
// с одним и тем же запросом Nano Banana то выпрямляет спинку носа, то
// возвращает кадр нетронутым. Измерено на профильном снимке с выраженной
// горбинкой: удачная правка даёт среднее отличие около 10 единиц яркости,
// неудачная — 1.5, то есть уровень шума перекодирования JPEG.
//
// Без этой проверки провал выглядит как успех: статус «Готово», картинка
// есть, а на ней ничего не изменилось. Врач четыре раза подряд решает, что
// сломана платформа.

import sharp from "sharp";

/** Ниже этого среднего отличия правку считаем несостоявшейся. */
export const WEAK_CHANGE_THRESHOLD = 4;

/** Размер, к которому приводим оба кадра перед сравнением. */
const COMPARE_WIDTH = 384;

/**
 * Среднее абсолютное отличие яркости двух изображений, 0-255.
 *
 * Оба кадра приводятся к одному размеру и в градации серого: модель
 * возвращает свой размер (1248x832 у Nano Banana против 547x365 у
 * оригинала), и сравнивать их «как есть» нельзя. Цвет отбрасываем
 * намеренно — интересует геометрия правки, а не тон кожи после
 * перекодирования.
 */
export async function meanAbsDiff(originalBuffer, resultBuffer) {
  const meta = await sharp(originalBuffer).metadata();
  const height = Math.max(
    1,
    Math.round((COMPARE_WIDTH * meta.height) / meta.width),
  );

  const toRaw = (buf) =>
    sharp(buf)
      .resize(COMPARE_WIDTH, height, { fit: "fill" })
      .greyscale()
      .raw()
      .toBuffer();

  const [a, b] = await Promise.all([toRaw(originalBuffer), toRaw(resultBuffer)]);

  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

export default { meanAbsDiff, WEAK_CHANGE_THRESHOLD };
