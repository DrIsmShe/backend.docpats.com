// server/modules/clinic/clinic-public/clinic-public-booking.service.js
//
// ЗАПИСЬ С ВИТРИНЫ. Два публичных действия:
//   1. посмотреть свободное время врача;
//   2. оставить заявку на запись к нему.
//
// Почему заявка, а не приём. Анонимный посетитель НЕ занимает календарь врача:
// иначе один скрипт забил бы расписание клиники на месяц вперёд, и защититься
// от этого можно было бы только капчей. Заявка ложится в тот же входящий
// список, где уже живут обращения с сайта, — у него есть и страница в
// кабинете, и права, и уведомления. Клиника оформляет приём сама.
//
// Публичный тенант-контекст. Скоупинг запросов требует clinicId, поэтому
// работа идёт внутри runWithTenantContext с контекстом БЕЗ роли: can() в нём
// откажет во всём, и это правильно — у посетителя прав нет. Все проверки
// доступа здесь явные и локальные: клиника опубликована, врач в ней работает,
// слот действительно свободен.

import mongoose from "mongoose";
import { runWithTenantContext } from "../../../common/context/tenantContext.js";
import { ValidationError, NotFoundError } from "../../../common/utils/errors.js";
import { computeBookableSlots } from "../clinic-appointments/services/appointment.service.js";
import Lead from "../clinic-leads/models/lead.model.js";
import { buildDoctorList, findPublishedClinicBySlug } from "./clinic-public.service.js";

const NAME_MAX = 200;
const PHONE_MAX = 40;
const MESSAGE_MAX = 2000;

/**
 * Клиника опубликована + врач действительно её сотрудник.
 *
 * Второе обязательно: без него /<любая-клиника>/…/<любой-врач> показывал бы
 * расписание чужого специалиста и принимал бы заявки от её имени.
 */
async function resolveClinicAndDoctor(slug, doctorId) {
  if (!doctorId || !mongoose.isValidObjectId(doctorId)) return null;

  const clinic = await findPublishedClinicBySlug(slug);
  if (!clinic) return null;

  const doctors = await buildDoctorList(clinic._id);
  const doctor = doctors.find((d) => String(d.id) === String(doctorId));
  if (!doctor) return null;

  return { clinic, doctor };
}

/** Публичный контекст: только clinicId, без роли и без прав. */
function inClinicContext(clinicId, fn) {
  return runWithTenantContext(
    {
      clinicId: String(clinicId),
      userId: null,
      role: null,
      permissions: {},
      membershipId: null,
      actorType: "public",
    },
    fn,
  );
}

/**
 * Свободное время врача для витрины.
 *
 * @returns {Promise<Object|null>} результат computeBookableSlots или null,
 *   если клиника скрыта либо врач в ней не работает
 */
export async function getPublicDoctorSlots(slug, doctorId, { from, to }) {
  const ctx = await resolveClinicAndDoctor(slug, doctorId);
  if (!ctx) return null;

  // userId врача — именно по нему ведётся расписание, тогда как в адресе
  // страницы стоит DoctorProfile._id.
  return inClinicContext(ctx.clinic._id, () =>
    computeBookableSlots({ doctorId: String(ctx.doctor.userId), from, to }),
  );
}

/**
 * Заявка на запись с витрины.
 *
 * @returns {Promise<Object|null>} созданная заявка или null (клиника/врач)
 */
export async function createPublicBooking(slug, doctorId, input = {}) {
  const ctx = await resolveClinicAndDoctor(slug, doctorId);
  if (!ctx) return null;

  const name = typeof input.name === "string" ? input.name.trim() : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const message = typeof input.message === "string" ? input.message.trim() : "";

  if (!name) throw new ValidationError("name is required", { field: "name" });
  if (!phone) throw new ValidationError("phone is required", { field: "phone" });
  if (name.length > NAME_MAX) throw new ValidationError("name is too long");
  if (phone.length > PHONE_MAX) throw new ValidationError("phone is too long");
  if (message.length > MESSAGE_MAX) {
    throw new ValidationError("message is too long");
  }

  const startUTC = new Date(input.startUTC);
  if (Number.isNaN(startUTC.getTime())) {
    throw new ValidationError("startUTC is not a valid date", {
      field: "startUTC",
    });
  }
  // Прошедшее время — почти всегда устаревшая вкладка, а не злой умысел, но
  // принимать такую заявку незачем: менеджер всё равно перезвонит уточнять.
  if (startUTC.getTime() < Date.now()) {
    throw new ValidationError("startUTC is in the past", { field: "startUTC" });
  }

  // Слот перепроверяется на сервере. Список приходил клиенту раньше и мог
  // устареть; полагаться на него значит принимать заявки на время, которого у
  // врача нет.
  const day = startUTC.toISOString().slice(0, 10);
  const slots = await inClinicContext(ctx.clinic._id, () =>
    computeBookableSlots({
      doctorId: String(ctx.doctor.userId),
      from: day,
      to: day,
    }),
  );

  const offered = (slots?.days || [])
    .flatMap((d) => d.slots || [])
    .some((sl) => new Date(sl.startUTC).getTime() === startUTC.getTime());

  if (!offered) {
    throw new NotFoundError("Slot is no longer available");
  }

  const lead = await Lead.create({
    clinicId: ctx.clinic._id,
    name,
    phone,
    message,
    type: "booking",
    source: "vitrina",
    desiredDoctorId: ctx.doctor.id,
    desiredStartUTC: startUTC,
  });

  return {
    id: String(lead._id),
    status: lead.status,
    doctorName: ctx.doctor.name || "",
    startUTC: startUTC.toISOString(),
  };
}

export default { getPublicDoctorSlots, createPublicBooking };
