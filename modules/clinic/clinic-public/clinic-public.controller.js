// server/modules/clinic/clinic-public/clinic-public.controller.js
//
// Clinic-as-Brand (этап A) — контроллер гостевой страницы /clinic/:slug.
//
// ВАЖНО: этот роут монтируется ВНЕ clinic-домена (на /api/v1/public),
// без authMiddleware и без tenantMiddleware. Поэтому НЕ полагаемся на
// asyncHandler/errorHandler clinic-модуля — оборачиваем сами в try/catch.

import { getPublicClinicBySlug } from "./clinic-public.service.js";

/**
 * GET /api/v1/public/clinics/:slug
 * Публичный профиль клиники. Без авторизации.
 * 200 → publicClinicDTO | 404 → не найдено / не опубликовано.
 */
export async function getPublicClinicController(req, res) {
  try {
    const { slug } = req.params;

    const dto = await getPublicClinicBySlug(slug);

    if (!dto) {
      return res.status(404).json({
        error: "Clinic not found",
        code: "CLINIC_NOT_FOUND",
      });
    }

    // Публичная страница — можно кэшировать ненадолго на CDN/браузере
    res.set("Cache-Control", "public, max-age=60");
    return res.status(200).json(dto);
  } catch (err) {
    // Никакого PHI в публичном эндпоинте — лог безопасен
    console.error("[clinic-public] getPublicClinic error:", err?.message);
    return res.status(500).json({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }
}
