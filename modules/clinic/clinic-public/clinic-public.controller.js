// server/modules/clinic/clinic-public/clinic-public.controller.js
//
// Clinic-as-Brand (этап A) — контроллер гостевой страницы /clinic/:slug.
//
// ВАЖНО: этот роут монтируется ВНЕ clinic-домена (на /api/v1/public),
// без authMiddleware и без tenantMiddleware. Поэтому НЕ полагаемся на
// asyncHandler/errorHandler clinic-модуля — оборачиваем сами в try/catch.

import { getPublicClinicBySlug } from "./clinic-public.service.js";
import { getPublicClinicDoctor } from "./clinic-public-doctor.service.js";
import { getPublicClinicPublication } from "./clinic-public-publication.service.js";
import { errorText } from "../../../common/i18n/index.js";
import {
  getPublicDoctorSlots,
  createPublicBooking,
} from "./clinic-public-booking.service.js";

/**
 * GET /api/v1/public/clinics/:slug
 * Публичный профиль клиники. Без авторизации.
 * 200 → publicClinicDTO | 404 → не найдено / не опубликовано.
 */
// Язык запроса: сначала явный ?locale=, потом заголовок интерфейса.
//
// Порядок важен из-за КЭША. Ответ кэшируется на минуту, а CDN различает
// запросы по адресу, не по заголовкам — значит язык, взятый из заголовка,
// может «прилипнуть» к адресу и приехать чужому посетителю. Поэтому явный
// параметр главнее, а когда язык пришёл заголовком, отвечаем Vary.
function resolveLocale(req) {
  const allowed = ["ru", "en", "az", "tr", "ar"];
  const fromQuery = String(req.query?.locale || "").trim().toLowerCase();
  if (allowed.includes(fromQuery)) return { locale: fromQuery, fromHeader: false };

  const fromHeader = String(req.get("X-Language") || "").slice(0, 2).toLowerCase();
  if (allowed.includes(fromHeader)) return { locale: fromHeader, fromHeader: true };

  return { locale: null, fromHeader: false };
}

export async function getPublicClinicController(req, res) {
  try {
    const { slug } = req.params;
    const { locale, fromHeader } = resolveLocale(req);

    const dto = await getPublicClinicBySlug(slug, { locale });

    if (!dto) {
      return res.status(404).json({
        error: "Clinic not found",
        code: "CLINIC_NOT_FOUND",
      });
    }

    // Публичная страница — можно кэшировать ненадолго на CDN/браузере
    res.set("Cache-Control", "public, max-age=60");
    if (fromHeader) res.set("Vary", "X-Language");
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

/**
 * GET /api/v1/public/clinics/:slug/doctors/:doctorId
 * Профиль врача внутри витрины клиники. Без авторизации.
 * 200 → DTO врача | 404 → нет клиники, нет врача, или врач не из этой клиники.
 *
 * Все три случая отдают один и тот же 404 намеренно: разные ответы позволили бы
 * перебором выяснять, кто где работает.
 */
export async function getPublicClinicDoctorController(req, res) {
  try {
    const dto = await getPublicClinicDoctor(req.params.slug, req.params.doctorId);

    if (!dto) {
      return res.status(404).json({
        error: "Doctor not found",
        code: "CLINIC_DOCTOR_NOT_FOUND",
      });
    }

    res.set("Cache-Control", "public, max-age=60");
    return res.status(200).json(dto);
  } catch (err) {
    console.error("[clinic-public] getPublicClinicDoctor error:", err?.message);
    return res.status(500).json({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }
}

/**
 * GET /api/v1/public/clinics/:slug/publications/:id
 * Публикация врача клиники внутри витрины. Без авторизации.
 * 200 → DTO публикации | 404 → нет клиники, нет статьи, или автор не из этой клиники.
 */
export async function getPublicClinicPublicationController(req, res) {
  try {
    const dto = await getPublicClinicPublication(req.params.slug, req.params.id);

    if (!dto) {
      return res.status(404).json({
        error: "Publication not found",
        code: "CLINIC_PUBLICATION_NOT_FOUND",
      });
    }

    res.set("Cache-Control", "public, max-age=60");
    return res.status(200).json(dto);
  } catch (err) {
    console.error(
      "[clinic-public] getPublicClinicPublication error:",
      err?.message,
    );
    return res.status(500).json({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }
}

/**
 * GET /api/v1/public/clinics/:slug/doctors/:doctorId/slots?from=&to=
 *
 * Свободное время врача для витрины. Без авторизации: расписание приёма — не
 * секрет, ради него страницу врача и открывают.
 */
export async function getPublicDoctorSlotsController(req, res) {
  try {
    const { slug, doctorId } = req.params;
    const { from, to } = req.query;

    const slots = await getPublicDoctorSlots(slug, doctorId, { from, to });

    if (!slots) {
      return res.status(404).json({
        error: "Doctor not found",
        code: "CLINIC_DOCTOR_NOT_FOUND",
      });
    }

    // Свободное время меняется чаще, чем профиль: минута кэша здесь была бы
    // обещанием, которое расписание не держит.
    res.set("Cache-Control", "no-store");
    return res.status(200).json(slots);
  } catch (err) {
    // Ошибки валидации диапазона дат приходят отсюда же — это 400, не 500.
    if (err?.name === "ValidationError") {
      return res.status(400).json({ error: errorText(err, req), code: "BAD_REQUEST" });
    }
    console.error("[clinic-public] getPublicDoctorSlots error:", err?.message);
    return res.status(500).json({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }
}

/**
 * POST /api/v1/public/clinics/:slug/doctors/:doctorId/booking
 *
 * Заявка на запись. НЕ приём: анонимный посетитель не занимает календарь
 * врача — подробности в clinic-public-booking.service.js.
 */
export async function createPublicBookingController(req, res) {
  try {
    const { slug, doctorId } = req.params;

    const booking = await createPublicBooking(slug, doctorId, req.body || {});

    if (!booking) {
      return res.status(404).json({
        error: "Doctor not found",
        code: "CLINIC_DOCTOR_NOT_FOUND",
      });
    }

    return res.status(201).json({ ok: true, ...booking });
  } catch (err) {
    if (err?.name === "ValidationError") {
      return res.status(400).json({ error: errorText(err, req), code: "BAD_REQUEST" });
    }
    // Слот заняли, пока посетитель заполнял форму — это нормальный ход
    // событий, а не сбой: отвечаем отдельным кодом, чтобы страница могла
    // предложить обновить список.
    if (err?.name === "NotFoundError") {
      return res.status(409).json({
        error: "Slot is no longer available",
        code: "SLOT_TAKEN",
      });
    }
    console.error("[clinic-public] createPublicBooking error:", err?.message);
    return res.status(500).json({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }
}
