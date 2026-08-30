// modules/clinic/clinic-medical/pdf/rtl.js
//
// Разворот строки для арабского бланка.
//
// pdfkit не умеет двунаправленный текст: он выкладывает глифы слева направо в
// том порядке, в каком они лежат в строке. Поэтому арабский текст приходится
// разворачивать вручную перед выводом.
//
// Сплошной разворот всей строки, который стоял здесь раньше, ломал числа:
// номер лицензии 1234567890 печатался как 0987654321, а доза «500 мг» — как
// «005». На рецепте это не косметика: перевёрнутая дозировка читается как
// другая дозировка. По правилам двунаправленного письма цифры и латиница
// внутри арабского текста сохраняют свой порядок — разворачивается только
// последовательность фрагментов и сами арабские буквы.

// Арабские буквы. Цифры — и латинские, и арабо-индийские (٠١٢٣…) — сюда не
// входят намеренно: в двунаправленном письме число всегда читается слева
// направо, и разворот превратил бы 2026 в 6202, а дозу 500 — в 005.
const ARABIC =
  /[ؠ-يٮ-ۓەݐ-ݿﭐ-﷿ﹰ-﻿]/;

const RTL_LANGS = new Set(["ar"]);

export function prepareRtl(text, lang) {
  if (!RTL_LANGS.has(lang) || !text) return text;
  const str = String(text);

  // Режем на куски: арабский / не арабский. Пробелы липнут к текущему куску —
  // на разделении фрагментов это не сказывается.
  const runs = [];
  let buf = "";
  let bufIsArabic = null;
  for (const ch of str) {
    const isArabic = ARABIC.test(ch);
    if (bufIsArabic === null || isArabic === bufIsArabic) {
      buf += ch;
      bufIsArabic = isArabic;
    } else {
      runs.push({ text: buf, arabic: bufIsArabic });
      buf = ch;
      bufIsArabic = isArabic;
    }
  }
  if (buf) runs.push({ text: buf, arabic: bufIsArabic });

  return runs
    .reverse()
    .map((r) => {
      if (r.arabic) return [...r.text].reverse().join("");
      // Отражая кусок, отражаем и пробелы по его краям: иначе пробел,
      // стоявший после числа, уезжает в конец строки, и «٢٩ أغسطس ٢٠٢٦»
      // печатается слипшимся.
      const m = r.text.match(/^(\s*)([\s\S]*?)(\s*)$/);
      return m ? m[3] + m[2] + m[1] : r.text;
    })
    .join("");
}

export { RTL_LANGS };
export default prepareRtl;
