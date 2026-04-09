export const resolveLanguage = (req, res, next) => {
  const allowed = ["en", "ru", "az", "tr", "ar"];

  let lang =
    req.query.lang ||
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
