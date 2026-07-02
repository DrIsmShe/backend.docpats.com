// server/modules/clinic/clinic-public/theme-presets.service.js
//
// ВИТРИНА 2.0 (V2) — данные для switcher'а темы.
// Единый источник — themePresets.js. Отдаём ПОЛНЫЕ словари, чтобы клиент мог
// резолвить тему локально точь-в-точь как серверный resolveTheme (мгновенный
// preview без round-trip). Поэтому палитра отдаётся целиком (все 12 токенов),
// cardStyles — со своими CSS-переменными, heroStyles/pageBgStyles — с конфигом.
//
// Чистая функция, без БД. Ключи стабильны; подписи локализуются на клиенте.

import {
  PALETTES,
  FONT_PAIRS,
  HERO_STYLES,
  CARD_STYLES,
  PAGE_BG_STYLES,
  PRESETS,
  DEFAULT_THEME,
} from "../clinic-core/themePresets.js";

export function getThemePresetsPayload() {
  return {
    default: { ...DEFAULT_THEME },

    presets: Object.entries(PRESETS).map(([key, v]) => ({ key, ...v })),

    // полная палитра (все токены) — клиент строит из неё cssVars
    palettes: Object.entries(PALETTES).map(([key, tokens]) => ({
      key,
      tokens: { ...tokens },
    })),

    // importUrl нужен, чтобы превью подгружало шрифт пары
    fontPairs: Object.entries(FONT_PAIRS).map(([key, f]) => ({
      key,
      heading: f.heading,
      body: f.body,
      importUrl: f.importUrl,
    })),

    // vars — CSS-переменные карточного стиля (--v-card-*, --v-radius)
    cardStyles: Object.entries(CARD_STYLES).map(([key, vars]) => ({
      key,
      vars: { ...vars },
    })),

    // config — фон/оверлей/тон/обложка/раскладка hero-блока
    heroStyles: Object.entries(HERO_STYLES).map(([key, config]) => ({
      key,
      config: { ...config },
    })),

    // config — фон ВСЕЙ страницы (none/gradient/photo): background/overlay/fixed/needsImage
    pageBgStyles: Object.entries(PAGE_BG_STYLES).map(([key, config]) => ({
      key,
      config: { ...config },
    })),
  };
}
