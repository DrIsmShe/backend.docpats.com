// utils/sanitizeUsername.js
const translitMap = {
  // Азербайджанский / Турецкий
  ə: "e",
  Ə: "E",
  ı: "i",
  İ: "i", // i без точки и I с точкой → i
  ö: "o",
  Ö: "O",
  ü: "u",
  Ü: "U",
  ğ: "g",
  Ğ: "G",
  ş: "s",
  Ş: "S",
  ç: "c",
  Ç: "C",
  // Частые диакритики латиницы
  à: "a",
  á: "a",
  ä: "a",
  â: "a",
  ã: "a",
  å: "a",
  À: "A",
  Á: "A",
  Ä: "A",
  Â: "A",
  Ã: "A",
  Å: "A",
  è: "e",
  é: "e",
  ë: "e",
  ê: "e",
  È: "E",
  É: "E",
  Ë: "E",
  Ê: "E",
  ì: "i",
  í: "i",
  ï: "i",
  î: "i",
  Ì: "I",
  Í: "I",
  Ï: "I",
  Î: "I",
  ò: "o",
  ó: "o",
  ö: "o",
  ô: "o",
  õ: "o",
  Ò: "O",
  Ó: "O",
  Ö: "O",
  Ô: "O",
  Õ: "O",
  ù: "u",
  ú: "u",
  ü: "u",
  û: "u",
  Ù: "U",
  Ú: "U",
  Ü: "U",
  Û: "U",
  ñ: "n",
  Ñ: "N",
};

export function sanitizeUsername(input) {
  const s = String(input || "").trim();

  // Транслитерация по карте
  const mapped = [...s].map((ch) => translitMap[ch] ?? ch).join("");

  // Удалить комбинируемые диакритики (напр. "i̇")
  const withoutCombining = mapped
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

  // Разрешить только [a-zA-Z0-9._-], привести к нижнему
  let ascii = withoutCombining.replace(/[^a-zA-Z0-9._-]+/g, "").toLowerCase();

  // Удалить точки/дефисы/подчёркивания на краях и сжать повторяющиеся
  ascii = ascii.replace(/^([._-])+|([._-])+$/g, "").replace(/[._-]{2,}/g, "-");

  // Ограничить длину
  if (ascii.length > 30) ascii = ascii.slice(0, 30);

  // Минимум 3 символа — при необходимости добить
  if (ascii.length < 3) ascii = (ascii + "123").slice(0, 3);

  return ascii;
}
