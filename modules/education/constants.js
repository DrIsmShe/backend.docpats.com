// server/modules/education/constants.js
//
// Общие справочники модуля подготовки к экзаменам.
// Держим их в одном файле, потому что каталог, банк вопросов, попытки и
// импорт ссылаются на одни и те же перечисления — рассинхрон здесь ломает
// сразу всё (enum в модели, zod-валидатор и фильтры в сервисе).

// ─── География ────────────────────────────────────────────────────────
// Регион — грубая группировка для витрины и аналитики. Страна хранится
// отдельно как ISO 3166-1 alpha-2 в верхнем регистре ("TR", "SA", "AZ",
// "RU", "DE"), плюс псевдо-код "INT" для наднациональных экзаменов
// (USMLE-подобные международные сертификаты, PLAB, курсы ВОЗ и т.п.).
export const EXAM_REGIONS = [
  "cis", // СНГ
  "europe",
  "mena", // Ближний Восток и Северная Африка
  "asia",
  "africa",
  "americas",
  "oceania",
  "international", // без привязки к стране
];

export const INTERNATIONAL_COUNTRY_CODE = "INT";

// ─── Типы экзаменов ───────────────────────────────────────────────────
// Покрывает то, ради чего врач вообще садится готовиться. Расширяется
// добавлением строки сюда + строки в ROLE-независимую витрину.
export const EXAM_TYPES = [
  "licensing", // допуск к практике (SMLE, DHA, MOH, гос. аккредитация)
  "residency_entrance", // вход в резидентуру / ординатуру (TUS, аккредитация)
  "board_certification", // сертификация по специальности
  "international_certificate", // международные сертификаты
  "cme", // непрерывное медицинское образование / НМО-баллы
  "university", // вузовские экзамены, госы
  "internal_training", // внутреннее обучение персонала клиники
];

// ─── Языки ────────────────────────────────────────────────────────────
// Совпадают с локалями фронтенда (client/public/locales).
export const EXAM_LANGUAGES = ["ru", "en", "az", "tr", "ar"];
export const DEFAULT_EXAM_LANGUAGE = "ru";

// ─── Происхождение контента ───────────────────────────────────────────
// ЮРИДИЧЕСКИ ЗНАЧИМОЕ ПОЛЕ. Мы не имеем права копировать вопросы чужих
// коммерческих банков, поэтому каждый вопрос обязан нести источник:
//
//   original          — написан авторами проекта
//   public_government — государственный / официальный материал, открыто
//                       опубликованный и разрешённый к использованию для
//                       подготовки (обязательно заполнить authority + url)
//   licensed          — получен по лицензии (заполнить licenseNote)
//   ai_generated      — черновик, сгенерированный ИИ из загруженного файла;
//                       публикация возможна ТОЛЬКО после ревью человеком
//                       (см. item.service.js → assertPublishable)
export const SOURCE_KINDS = [
  "original",
  "public_government",
  "licensed",
  "ai_generated",
];

// Источники, которые нельзя публиковать без явного ревью человеком.
export const SOURCE_KINDS_REQUIRING_REVIEW = ["ai_generated"];

// ─── Жизненный цикл ───────────────────────────────────────────────────
export const CATALOG_STATUSES = ["draft", "published", "archived"];

export const ITEM_STATUSES = [
  "draft", // черновик автора
  "in_review", // отправлен рецензенту
  "published", // виден учащимся
  "rejected", // рецензент отклонил
  "archived", // выведен из оборота, но нужен для старых попыток
];

// ─── Вопросы ──────────────────────────────────────────────────────────
export const ITEM_TYPES = [
  "sba", // single best answer — стандарт медицинских экзаменов
  "multi", // несколько верных вариантов
  "true_false",
  "vignette", // клиническая виньетка с данными обследования
  "image", // вопрос по изображению (рентген, ЭКГ, гистология)
  "case", // кейс из модуля simulation
];

export const ITEM_DIFFICULTIES = ["easy", "medium", "hard"];

// ─── Режимы прохождения ───────────────────────────────────────────────
//   tutor  — объяснение сразу после каждого ответа, без таймера
//   timed  — таймер есть, объяснения только в конце
//   mock   — полная симуляция экзамена: состав по blueprint, таймер, отчёт
//   drill  — добивка слабых тем (по статистике прошлых попыток)
export const ATTEMPT_MODES = ["tutor", "timed", "mock", "drill"];

export const ATTEMPT_STATUSES = [
  "in_progress",
  "submitted",
  "expired", // вышло время, засчитан автоматически
  "abandoned",
];

// ─── Импорт ───────────────────────────────────────────────────────────
export const IMPORT_STATUSES = [
  "pending", // создан, файл принят
  "extracting", // экстрактор работает
  "extracted", // черновики получены, ждут ревью
  "imported", // черновики перенесены в банк вопросов
  "failed",
  "cancelled", // оператор остановил распознавание вручную
];

// Что умеем принимать на вход ИИ-импорта.
//
// Список НЕ является валидатором: браузеры врут о типах (.csv приходит как
// application/vnd.ms-excel, .md — с пустым типом), поэтому фактическая
// проверка идёт через education-ingest/extractors/fileTypes.js, где тип
// определяется по MIME ИЛИ по расширению. Здесь — только подсказка для
// формы загрузки и документации.
export const IMPORT_MIME_TYPES = [
  // Уходят в API как есть
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  // Приводим к тексту на своей стороне
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
  "text/html",
  "text/rtf",
  "application/rtf",
  "application/json",
  "application/xml",
  "text/xml",
];
