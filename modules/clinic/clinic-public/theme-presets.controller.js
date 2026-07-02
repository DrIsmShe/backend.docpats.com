// server/modules/clinic/clinic-public/theme-presets.controller.js
//
// ВИТРИНА 2.0 (V2) — публичный эндпоинт словарей темы для switcher'а.
// Статика (зависит только от кода themePresets.js) → кэшируем.
//
// Маршрут (добавить в публичный роутер clinic-public):
//   router.get("/theme-presets", getThemePresets);
// Полный путь: GET /api/v1/public/theme-presets — без авторизации.

import { getThemePresetsPayload } from "./theme-presets.service.js";
export function getThemePresets(req, res) {
  res.set("Cache-Control", "public, max-age=3600"); // словари меняются редко
  res.json(getThemePresetsPayload());
}
