// server/modules/clinic/clinic-public/clinic-public-doctor.service.js
//
// ВИТРИНА — публичный профиль врача В КОНТЕКСТЕ КЛИНИКИ:
//   GET /api/v1/public/clinics/:slug/doctors/:doctorId
//
// Профиль врача на платформе уже есть — /public/doctor-profile/doctor-details/:id.
// Но это страница ПЛАТФОРМЫ: она рендерится внутри DashboardLayout, со своей
// шапкой и своим брендом. Посетитель витрины уходил с сайта клиники ровно там,
// где клиника показывает главное — своих врачей. Этот эндпоинт отдаёт те же
// данные, чтобы витрина показала врача в СВОЁМ оформлении и по своему адресу.
//
// Гейт по клинике обязателен. Без проверки членства адрес
// /<любая-клиника>/doctors/<любой-врач> показывал бы чужого врача в чужом
// оформлении — то есть позволял бы любой клинике присвоить чужого специалиста.
//
// Сборку DTO не дублируем: buildDoctorList несёт всю проверенную логику
// (расшифровка имени, специализация, нормализация фото, вывод стажа). Берём
// список клиники и находим в нём нужного — на витрине врачей десятки, не тысячи.
// Поверх списка добавляем то, чего в карточке нет: полное «о себе» и
// публикации именно этого врача.

import mongoose from "mongoose";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import {
  buildDoctorList,
  findPublishedClinicBySlug,
} from "./clinic-public.service.js";
import { getClinicPublicationsByDoctorIds } from "./clinic-publications.service.js";

/**
 * Публичный профиль врача клиники.
 *
 * @param {string} slug      слаг клиники
 * @param {string} doctorId  DoctorProfile._id (НЕ userId — так же, как в
 *                           profileUrl публичной карточки врача)
 * @returns {Promise<Object|null>} DTO врача или null (клиника скрыта, врача
 *                                 нет, или он не состоит в этой клинике)
 */
export async function getPublicClinicDoctor(slug, doctorId) {
  if (!doctorId || !mongoose.isValidObjectId(doctorId)) return null;

  const clinic = await findPublishedClinicBySlug(slug);
  if (!clinic) return null;

  const profile = await DoctorProfile.findById(doctorId)
    .select("userId about")
    .lean();
  if (!profile?.userId) return null;

  // Членство проверяется тем же списком, что и витрина: врач, которого нет в
  // публичном списке клиники, не имеет и публичного профиля от её имени.
  const doctors = await buildDoctorList(clinic._id);
  const doctor = doctors.find((d) => d.userId === String(profile.userId));
  if (!doctor) return null;

  const publications = await getClinicPublicationsByDoctorIds(
    [profile.userId],
    { limit: 24 },
  );

  return {
    ...doctor,
    id: String(doctorId),
    // Клиника нужна и странице (заголовок, хлебные крошки), и edge-функции:
    // в разметке Physician врач указывается работающим в конкретной клинике.
    // Без этого поля edge пришлось бы делать второй запрос за той же клиникой.
    clinic: { name: clinic.name || "", slug: clinic.slug || "" },
    // В карточке «о себе» урезано до превью (shortAbout). На собственной
    // странице врача обрезать нечего — отдаём полный текст.
    about: typeof profile.about === "string" ? profile.about : "",
    publications,
  };
}
