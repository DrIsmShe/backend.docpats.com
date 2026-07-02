// server/modules/clinic/clinic-core/themePresets.js
//
// ВИТРИНА 2.0 — словари движка тем + резолвер.
//
// Модель (clinic.theme) хранит только КЛЮЧИ (palette/fontPair/heroStyle/
// cardStyle/preset). Этот файл — единственный источник значений. resolveTheme()
// маппит ключи → набор CSS-переменных (--v-*), которые фронт вешает инлайном на
// корневой div витрины; компоненты-блоки ссылаются на var(--v-*).
//
// ВАЛИДАЦИЯ: все геттеры дефолтятся при неизвестном ключе. Это и есть
// сервис-слойная валидация темы (модель пермиссивна, см. clinic.model.js).
//
// ДЕФОЛТ = cream-teal + lora-jakarta — повторяет текущий одобренный вид
// PublicClinicPage (cream #faf8f4 + teal + Lora/Plus Jakarta Sans), чтобы
// переход на витрину не давал визуального регресса. Прочие палитры/пары —
// вариативность сверху.
//
// Чистый JS, без зависимостей. Используется на бэке (DTO/резолв).
// На фронт значения приходят уже резолвнутыми через DTO (клиент — другой репо).

// ───────────────────────────────────────────────────────────────────────────
// PALETTES — цветовые токены.
// ───────────────────────────────────────────────────────────────────────────
export const PALETTES = {
  // ДЕФОЛТНАЯ. Снята с текущей PublicClinicPage (cream + teal).
  "cream-teal": {
    primary: "#0f766e",
    primaryDark: "#0c5e57",
    onPrimary: "#ffffff",
    accent: "#0d9488",
    bg: "#faf8f4",
    surface: "#ffffff",
    surfaceAlt: "#f3efe8",
    text: "#1c1917",
    textMuted: "#78716c",
    border: "#e7e2d8",
    // hero — концы 3-стопового градиента текущей шапки
    // (середина #0f766e добавляется в hero-блоке).
    heroFrom: "#0c4a6e",
    heroTo: "#065f46",
  },
  teal: {
    primary: "#0d9488",
    primaryDark: "#0f766e",
    onPrimary: "#ffffff",
    accent: "#14b8a6",
    bg: "#f8fafa",
    surface: "#ffffff",
    surfaceAlt: "#f1f5f5",
    text: "#0f1f1d",
    textMuted: "#5b7470",
    border: "#dce7e5",
    heroFrom: "#0d9488",
    heroTo: "#0e7490",
  },
  blue: {
    primary: "#2563eb",
    primaryDark: "#1d4ed8",
    onPrimary: "#ffffff",
    accent: "#3b82f6",
    bg: "#f8fafc",
    surface: "#ffffff",
    surfaceAlt: "#f1f5f9",
    text: "#0f172a",
    textMuted: "#64748b",
    border: "#e2e8f0",
    heroFrom: "#2563eb",
    heroTo: "#1e40af",
  },
  bordeaux: {
    primary: "#9b1c31",
    primaryDark: "#7a1626",
    onPrimary: "#ffffff",
    accent: "#c0392b",
    bg: "#faf6f4",
    surface: "#ffffff",
    surfaceAlt: "#f5ece9",
    text: "#2a1416",
    textMuted: "#8a5f63",
    border: "#ecd9d6",
    heroFrom: "#9b1c31",
    heroTo: "#6d1023",
  },
  green: {
    primary: "#16a34a",
    primaryDark: "#15803d",
    onPrimary: "#ffffff",
    accent: "#22c55e",
    bg: "#f6faf7",
    surface: "#ffffff",
    surfaceAlt: "#eef5f0",
    text: "#0f2417",
    textMuted: "#5c7766",
    border: "#d7e8dd",
    heroFrom: "#16a34a",
    heroTo: "#047857",
  },
  purple: {
    primary: "#7c3aed",
    primaryDark: "#6d28d9",
    onPrimary: "#ffffff",
    accent: "#a855f7",
    bg: "#faf8fd",
    surface: "#ffffff",
    surfaceAlt: "#f3eefb",
    text: "#1e1233",
    textMuted: "#6b5b86",
    border: "#e6dcf5",
    heroFrom: "#7c3aed",
    heroTo: "#5b21b6",
  },
  amber: {
    primary: "#d97706",
    primaryDark: "#b45309",
    onPrimary: "#ffffff",
    accent: "#f59e0b",
    bg: "#fdfaf4",
    surface: "#ffffff",
    surfaceAlt: "#f7efe1",
    text: "#2a1d0a",
    textMuted: "#8a7350",
    border: "#ecdec4",
    heroFrom: "#d97706",
    heroTo: "#b45309",
  },
  slate: {
    primary: "#334155",
    primaryDark: "#1e293b",
    onPrimary: "#ffffff",
    accent: "#64748b",
    bg: "#f8fafc",
    surface: "#ffffff",
    surfaceAlt: "#f1f5f9",
    text: "#0f172a",
    textMuted: "#64748b",
    border: "#e2e8f0",
    heroFrom: "#334155",
    heroTo: "#0f172a",
  },
  rose: {
    primary: "#e11d48",
    primaryDark: "#be123c",
    onPrimary: "#ffffff",
    accent: "#f43f5e",
    bg: "#fef6f8",
    surface: "#ffffff",
    surfaceAlt: "#fbe9ee",
    text: "#2a0f17",
    textMuted: "#8a5965",
    border: "#f3d4dc",
    heroFrom: "#e11d48",
    heroTo: "#9f1239",
  },
};

// ───────────────────────────────────────────────────────────────────────────
// FONT_PAIRS — пары шрифтов (заголовок + текст) + Google Fonts URL.
// ───────────────────────────────────────────────────────────────────────────
export const FONT_PAIRS = {
  // ДЕФОЛТНАЯ. Снята с текущей PublicClinicPage.
  "lora-jakarta": {
    heading: '"Lora", Georgia, serif',
    body: '"Plus Jakarta Sans", system-ui, sans-serif',
    importUrl:
      "https://fonts.googleapis.com/css2?family=Lora:wght@400;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap",
  },
  "sans-modern": {
    heading: '"Manrope", sans-serif',
    body: '"Inter", sans-serif',
    importUrl:
      "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Manrope:wght@600;700;800&display=swap",
  },
  "serif-classic": {
    heading: '"Playfair Display", serif',
    body: '"Source Sans 3", sans-serif',
    importUrl:
      "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800&family=Source+Sans+3:wght@400;500;600&display=swap",
  },
  geometric: {
    heading: '"Poppins", sans-serif',
    body: '"Inter", sans-serif',
    importUrl:
      "https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700&family=Inter:wght@400;500&display=swap",
  },
  editorial: {
    heading: '"Fraunces", serif',
    body: '"Inter", sans-serif',
    importUrl:
      "https://fonts.googleapis.com/css2?family=Fraunces:wght@500;600;700&family=Inter:wght@400;500&display=swap",
  },
};

// ───────────────────────────────────────────────────────────────────────────
// CARD_STYLES — стиль карточек. Вносит свои CSS-переменные (--v-card-*, --v-radius).
// ───────────────────────────────────────────────────────────────────────────
export const CARD_STYLES = {
  elevated: {
    "--v-card-bg": "var(--v-surface)",
    "--v-card-border": "1px solid transparent",
    "--v-card-shadow": "0 4px 20px rgba(0,0,0,.07)",
    "--v-radius": "16px",
  },
  flat: {
    "--v-card-bg": "var(--v-surface)",
    "--v-card-border": "1px solid transparent",
    "--v-card-shadow": "none",
    "--v-radius": "12px",
  },
  outline: {
    "--v-card-bg": "var(--v-surface)",
    "--v-card-border": "1px solid var(--v-border)",
    "--v-card-shadow": "none",
    "--v-radius": "12px",
  },
  soft: {
    "--v-card-bg": "var(--v-surface-alt)",
    "--v-card-border": "1px solid transparent",
    "--v-card-shadow": "0 2px 10px rgba(0,0,0,.04)",
    "--v-radius": "20px",
  },
};

// ───────────────────────────────────────────────────────────────────────────
// HERO_STYLES — конфиг hero-блока. Компонент hero (V1) ветвится по ключу.
// ───────────────────────────────────────────────────────────────────────────
export const HERO_STYLES = {
  gradient: {
    background: "linear-gradient(135deg, var(--v-hero-from), var(--v-hero-to))",
    textTone: "light",
    needsCover: false,
  },
  photo: {
    background: "var(--v-surface)",
    overlay: "rgba(0,0,0,.45)",
    textTone: "light",
    needsCover: true,
  },
  minimal: {
    background: "var(--v-bg)",
    textTone: "dark",
    needsCover: false,
  },
  split: {
    background: "var(--v-surface)",
    textTone: "dark",
    needsCover: true,
    layout: "split",
  },
};

// ───────────────────────────────────────────────────────────────────────────
// PAGE_BG_STYLES — фон ВСЕЙ страницы витрины (за всеми блоками), независимо
// от hero. Рендерер (VitrinaRenderer) ветвится по ключу:
//   none     — сплошной --v-bg (как было; дефолт, обратная совместимость)
//   gradient — мягкий диагональный градиент из токенов палитры
//   photo    — фоновое фото (clinic.pageBackground) + лёгкий оверлей под --v-bg
//              для читаемости контента между карточками. needsImage:true →
//              если фото нет, рендерер откатывается на none.
// ───────────────────────────────────────────────────────────────────────────
export const PAGE_BG_STYLES = {
  none: {
    needsImage: false,
  },
  gradient: {
    // мягкий, низкоконтрастный — фон, не отвлекает от контента
    background:
      "linear-gradient(160deg, var(--v-bg) 0%, var(--v-surface-alt) 100%)",
    needsImage: false,
  },
  photo: {
    // фото кладёт рендерер (background-image); overlay поверх для читаемости
    overlay:
      "linear-gradient(180deg, color-mix(in srgb, var(--v-bg) 82%, transparent) 0%, color-mix(in srgb, var(--v-bg) 92%, transparent) 100%)",
    fixed: true, // background-attachment: fixed — параллакс-эффект
    needsImage: true,
  },
};

// ───────────────────────────────────────────────────────────────────────────
// PRESETS — именованные бандлы для быстрого выбора в UI.
// classic совпадает с дефолтами модели (cream-teal/lora-jakarta/gradient/elevated).
// ───────────────────────────────────────────────────────────────────────────
export const PRESETS = {
  classic: {
    palette: "cream-teal",
    fontPair: "lora-jakarta",
    heroStyle: "gradient",
    cardStyle: "elevated",
  },
  modern: {
    palette: "blue",
    fontPair: "sans-modern",
    heroStyle: "split",
    cardStyle: "flat",
  },
  warm: {
    palette: "amber",
    fontPair: "editorial",
    heroStyle: "photo",
    cardStyle: "soft",
  },
  clinical: {
    palette: "slate",
    fontPair: "sans-modern",
    heroStyle: "minimal",
    cardStyle: "outline",
  },
  bold: {
    palette: "bordeaux",
    fontPair: "serif-classic",
    heroStyle: "gradient",
    cardStyle: "elevated",
  },
  nature: {
    palette: "green",
    fontPair: "geometric",
    heroStyle: "gradient",
    cardStyle: "soft",
  },
};

// Дефолтные ключи — совпадают с дефолтами themeSchema в clinic.model.js.
export const DEFAULT_THEME = {
  preset: "classic",
  palette: "cream-teal",
  fontPair: "lora-jakarta",
  heroStyle: "gradient",
  cardStyle: "elevated",
  pageBgStyle: "none",
  pageBgDim: 85,
  contentWidth: 1040,
  heroHeight: 0,
};

// ───────────────────────────────────────────────────────────────────────────
// Геттеры с дефолтом (валидация ключей).
// ───────────────────────────────────────────────────────────────────────────
export function getPalette(key) {
  return PALETTES[key] || PALETTES[DEFAULT_THEME.palette];
}
export function getFontPair(key) {
  return FONT_PAIRS[key] || FONT_PAIRS[DEFAULT_THEME.fontPair];
}
export function getCardStyle(key) {
  return CARD_STYLES[key] || CARD_STYLES[DEFAULT_THEME.cardStyle];
}
export function getHeroStyle(key) {
  return HERO_STYLES[key] || HERO_STYLES[DEFAULT_THEME.heroStyle];
}
export function getPageBgStyle(key) {
  return PAGE_BG_STYLES[key] || PAGE_BG_STYLES[DEFAULT_THEME.pageBgStyle];
}

// applyPreset("modern") → { palette, fontPair, heroStyle, cardStyle }
export function applyPreset(presetKey) {
  return { ...(PRESETS[presetKey] || PRESETS[DEFAULT_THEME.preset]) };
}

// ───────────────────────────────────────────────────────────────────────────
// resolveTheme(theme) — главный резолвер.
//   { palette, fontPair, heroStyle, cardStyle, cssVars, fontImportUrl, hero }
// ───────────────────────────────────────────────────────────────────────────
export function resolveTheme(theme = {}) {
  const t = theme || {};
  const paletteKey = PALETTES[t.palette] ? t.palette : DEFAULT_THEME.palette;
  const fontPairKey = FONT_PAIRS[t.fontPair]
    ? t.fontPair
    : DEFAULT_THEME.fontPair;
  const heroStyleKey = HERO_STYLES[t.heroStyle]
    ? t.heroStyle
    : DEFAULT_THEME.heroStyle;
  const cardStyleKey = CARD_STYLES[t.cardStyle]
    ? t.cardStyle
    : DEFAULT_THEME.cardStyle;
  const pageBgStyleKey = PAGE_BG_STYLES[t.pageBgStyle]
    ? t.pageBgStyle
    : DEFAULT_THEME.pageBgStyle;

  // степень затемнения фото-фона: 0 = фото целиком, 92 = почти сплошной цвет.
  // Число вне диапазона/NaN → дефолт. Клампим в [0, 92].
  const rawDim = Number(t.pageBgDim);
  const pageBgDim = Number.isFinite(rawDim)
    ? Math.max(0, Math.min(92, Math.round(rawDim)))
    : DEFAULT_THEME.pageBgDim;

  // ширина контента всех блоков: [380..1600]. 1600 (макс) трактуем как 100%
  // (резиновая на всю ширину). Иначе фикс. px-кап по центру.
  const rawCW = Number(t.contentWidth);
  const contentWidth = Number.isFinite(rawCW)
    ? Math.max(380, Math.min(1600, Math.round(rawCW)))
    : DEFAULT_THEME.contentWidth;
  const contentMax = contentWidth >= 1600 ? "100%" : `${contentWidth}px`;

  // высота hero: 0 = авто (по контенту, как было). Иначе фикс. min-height,
  // кламп [100..850]px. Невалидное → дефолт.
  const rawHH = Number(t.heroHeight);
  const heroHeight = Number.isFinite(rawHH)
    ? rawHH <= 0
      ? 0
      : Math.max(100, Math.min(850, Math.round(rawHH)))
    : DEFAULT_THEME.heroHeight;
  const heroH = `${heroHeight}px`;

  const palette = PALETTES[paletteKey];
  const fontPair = FONT_PAIRS[fontPairKey];
  const cardStyle = CARD_STYLES[cardStyleKey];
  const hero = HERO_STYLES[heroStyleKey];
  const pageBg = PAGE_BG_STYLES[pageBgStyleKey];

  const cssVars = {
    "--v-primary": palette.primary,
    "--v-primary-dark": palette.primaryDark,
    "--v-on-primary": palette.onPrimary,
    "--v-accent": palette.accent,
    "--v-bg": palette.bg,
    "--v-surface": palette.surface,
    "--v-surface-alt": palette.surfaceAlt,
    "--v-text": palette.text,
    "--v-text-muted": palette.textMuted,
    "--v-border": palette.border,
    "--v-hero-from": palette.heroFrom,
    "--v-hero-to": palette.heroTo,
    "--v-font-heading": fontPair.heading,
    "--v-font-body": fontPair.body,
    "--v-content-max": contentMax,
    "--v-hero-h": heroH,
    ...cardStyle,
  };

  return {
    palette: paletteKey,
    fontPair: fontPairKey,
    heroStyle: heroStyleKey,
    cardStyle: cardStyleKey,
    pageBgStyle: pageBgStyleKey,
    pageBgDim,
    contentWidth,
    heroHeight,
    cssVars,
    fontImportUrl: fontPair.importUrl,
    hero,
    // pageBg — конфиг фона страницы; фоновое фото (pageBackground) подставляет
    // рендерер инлайном (как hero coverImage). Здесь только стиль/оверлей/флаги.
    pageBg,
  };
}
