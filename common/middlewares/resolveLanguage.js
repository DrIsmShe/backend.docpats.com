// Каноническое имя параметра — `locale`: его уже используют новости и
// витрины клиник, и он же теперь пишется в карту сайта. `lang` остаётся
// рабочим и читается первым по старшинству ровно потому, что живые ссылки с
// ним существуют: выкатка не должна их обесточить.
//
// Двух имён у одной вещи быть не должно, и это шаг к одному, а не закрепление
// двух. Когда `lang` перестанет встречаться в ссылках и коде, строку с ним
// можно убрать — поведение не изменится.
export const resolveLanguage = (req, res, next) => {
  const allowed = ["en", "ru", "az", "tr", "ar"];

  let lang =
    req.query.lang ||
    req.query.locale ||
    req.headers["x-language"] ||
    req.headers["accept-language"]?.split(",")[0]?.split("-")[0] || // ← добавить
    req.user?.preferredLanguage ||
    "en";

  if (!allowed.includes(lang)) {
    lang = "en";
  }

  req.language = lang;
  next();
};
