// server/modules/clinic/clinic-public/clinic-public.service.js
//
// Clinic-as-Brand (этап A→D) — сервис гостевой страницы /clinic/:slug.
//
// Работает БЕЗ tenant-контекста и БЕЗ авторизации (публичный эндпоинт):
//   - Clinic     — softDelete-плагин, не tenant-scoped → findOne по slug ок
//   - ClinicMembership — clinicId объявлен вручную, tenant-плагина НЕТ →
//                  skipTenantScope не требуется
//   - User / DoctorProfile / Specialization — общие модели, не tenant-scoped
//
// Сборка врача повторяет проверенный паттерн AllDoctorController:
//   - имена: userDoc.decryptFields() → { firstName, lastName }
//   - специализация: User.specialization → Specialization (fallback profile.specialty)
//   - фото: profile.profileImage || user.avatar → normalizeImageUrl(R2_PUBLIC_URL)
//
// Этап C — отзывы (агрегат в clinic-reviews/services/review.service.js).
// Этап D — публикации врачей клиники (агрегат в clinic-publications.service.js).

import Clinic from "../clinic-core/models/clinic.model.js";
import ClinicMembership from "../clinic-staff/models/clinicMembership.model.js";
import User from "../../../common/models/Auth/users.js";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import Specialization from "../../../common/models/DoctorProfile/specialityOfDoctor.js";
import { getPublicReviewsAggregate } from "../clinic-reviews/services/review.service.js";
import { getClinicPublicationsByDoctorIds } from "./clinic-publications.service.js";
import {
  toPublicClinicDTO,
  toPublicDoctorDTO,
} from "./clinic-public.mapper.js";

// Роли, чьи участники попадают в публичный список врачей.
// ⚠ "doctor" подтверждён; "owner"/"admin" — сверить с ROLES (безвредно при
// несовпадении: просто не сматчится). Финальный гейт — наличие DoctorProfile.
const PUBLIC_DOCTOR_ROLES = ["doctor", "owner", "admin"];

/**
 * Нормализация URL картинки (копия проверенного хелпера из AllDoctorController).
 * Дефолтные плейсхолдеры → null. Абсолютные URL — как есть. Иначе — R2 CDN base.
 */
function normalizeImageUrl(raw, baseUrl) {
  if (!raw) return null;
  let value = String(raw).trim();
  if (
    value.includes("uploads/default") ||
    value.includes("default/doctor") ||
    (value.endsWith(".jpg") && value.includes("default"))
  ) {
    return null;
  }
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  value = value.replace(/^\/+/, "");
  if (!value.startsWith("uploads/")) {
    value = `uploads/${value}`;
  }
  const cleanBase = String(baseUrl || "").replace(/\/+$/, "");
  return cleanBase ? `${cleanBase}/${value}` : value;
}

/**
 * Расшифровка имени/фамилии врача из User-документа.
 * @param {import("mongoose").Document} userDoc полный doc (не lean!)
 * @returns {{ firstName: string, lastName: string }}
 */
function decryptName(userDoc) {
  if (userDoc?.decryptFields) {
    try {
      const d = userDoc.decryptFields();
      return {
        firstName: d.firstName || "",
        lastName: d.lastName || "",
      };
    } catch {
      return { firstName: "", lastName: "" };
    }
  }
  return { firstName: "", lastName: "" };
}

/**
 * Собрать публичный список врачей клиники.
 * Батчами, чтобы избежать N+1. В список попадают только участники
 * с актуальным членством (leftAt:null, isActive) И с DoctorProfile.
 *
 * @param {import("mongoose").Types.ObjectId|string} clinicId
 * @returns {Promise<Array>} массив publicDoctorDTO
 */
async function buildDoctorList(clinicId) {
  const publicR2 = process.env.R2_PUBLIC_URL;

  // 1. Актуальные членства нужных ролей, только actorType=user
  const memberships = await ClinicMembership.find({
    clinicId,
    role: { $in: PUBLIC_DOCTOR_ROLES },
    actorType: "user",
    leftAt: null,
    isActive: true,
  })
    .select("userId role")
    .lean();

  if (!memberships.length) return [];

  // Сохраняем порядок и роль по userId (для DTO)
  const roleByUser = new Map();
  const userIds = [];
  for (const m of memberships) {
    if (!m.userId) continue;
    const uid = String(m.userId);
    if (!roleByUser.has(uid)) {
      roleByUser.set(uid, m.role);
      userIds.push(m.userId);
    }
  }
  if (!userIds.length) return [];

  // 2. Профили врачей (гейт: только у кого есть DoctorProfile)
  const profiles = await DoctorProfile.find({ userId: { $in: userIds } })
    .select("userId profileImage isVerified about country specialty")
    .lean();

  const profileByUser = new Map();
  for (const p of profiles) {
    if (p.userId) profileByUser.set(String(p.userId), p);
  }
  if (!profileByUser.size) return [];

  // 3. Полные User-доки (нужны для decryptFields) — только те, у кого есть профиль
  const profiledUserIds = userIds.filter((id) => profileByUser.has(String(id)));
  const users = await User.find({ _id: { $in: profiledUserIds } });

  // 4. Специализации (User.specialization + fallback profile.specialty) одним запросом
  const specIds = new Set();
  const userById = new Map();
  for (const u of users) {
    userById.set(String(u._id), u);
    if (u.specialization) specIds.add(String(u.specialization));
  }
  for (const p of profiles) {
    if (p.specialty) specIds.add(String(p.specialty));
  }
  const specs = specIds.size
    ? await Specialization.find({ _id: { $in: [...specIds] } })
        .select("name")
        .lean()
    : [];
  const specNameById = new Map();
  for (const s of specs) specNameById.set(String(s._id), s.name);

  // 5. Сборка DTO в исходном порядке userIds
  const result = [];
  for (const uid of profiledUserIds) {
    const key = String(uid);
    const userDoc = userById.get(key);
    const profile = profileByUser.get(key);
    if (!userDoc || !profile) continue; // страховка

    const { firstName, lastName } = decryptName(userDoc);

    const specId = userDoc.specialization || profile.specialty;
    const specialization = specId
      ? specNameById.get(String(specId)) || null
      : null;

    const profileImage = normalizeImageUrl(
      profile.profileImage || userDoc.avatar || null,
      publicR2,
    );

    result.push(
      toPublicDoctorDTO({
        userId: key,
        firstName,
        lastName,
        profileImage,
        specialization,
        isVerified: profile.isVerified,
        about: profile.about,
        country: profile.country,
        role: roleByUser.get(key) || "doctor",
      }),
    );
  }

  return result;
}

/**
 * Публичный профиль клиники по slug.
 * @param {string} slug
 * @returns {Promise<Object|null>} publicClinicDTO или null (не найдено/не опубликовано)
 */
export async function getPublicClinicBySlug(slug) {
  if (!slug || typeof slug !== "string") return null;
  const normalized = slug.trim().toLowerCase();
  if (!normalized) return null;

  // softDelete-плагин сам отфильтрует удалённые клиники
  const clinic = await Clinic.findOne({
    slug: normalized,
    isPublished: true,
    isActive: true,
  }).lean();

  if (!clinic) return null;

  // Врачи и отзывы — параллельно
  const [doctors, reviews] = await Promise.all([
    buildDoctorList(clinic._id),
    getPublicReviewsAggregate(clinic._id, { limit: 20 }),
  ]);

  // Этап D — публикации: зависят от userId врачей, поэтому после buildDoctorList
  const doctorUserIds = doctors.map((d) => d.userId).filter(Boolean);
  const publications = await getClinicPublicationsByDoctorIds(doctorUserIds, {
    limit: 6,
  });

  return toPublicClinicDTO(clinic, doctors, reviews, publications);
}
