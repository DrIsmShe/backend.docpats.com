// server/modules/clinic/clinic-public/clinic-public.mapper.js
//
// Clinic-as-Brand (этап A→D) — публичные DTO для гостевой страницы /clinic/:slug.
//
// ПРИНЦИП БЕЗОПАСНОСТИ: наружу отдаём ТОЛЬКО явно перечисленные поля (whitelist).
// НЕ используем clinic.toJSON()/doc.toObject() — иначе приватные поля
// (legalName, taxId, ownerId, coordinates, tier, metadata, internal flags)
// рискуют утечь. Каждое поле копируем руками.
//
// Мапперы ПОЛНОСТЬЮ ЧИСТЫЕ: ни БД, ни decrypt, ни env.
//  - decrypt имён врача/автора и сборку источников делает сервис
//  - публикации приходят уже как массив превью-DTO из clinic-publications.service.js

const ABOUT_MAX = 280;

/**
 * Обрезка био до короткой карточной выжимки.
 * @param {string|null|undefined} text
 * @returns {string}
 */
function shortAbout(text) {
  if (!text || typeof text !== "string") return "";
  const trimmed = text.trim();
  if (trimmed.length <= ABOUT_MAX) return trimmed;
  return trimmed.slice(0, ABOUT_MAX).trimEnd() + "…";
}

/**
 * Публичный DTO одного врача клиники.
 * Все поля приходят УЖЕ собранными/расшифрованными из сервиса.
 *
 * @param {Object} parts
 * @param {string} parts.userId               User._id (для ссылки на профиль)
 * @param {string} [parts.firstName]          расшифровано в сервисе
 * @param {string} [parts.lastName]           расшифровано в сервисе
 * @param {string|null} [parts.profileImage]  DoctorProfile.profileImage
 * @param {string|null} [parts.specialization] имя из Specialization (после populate)
 * @param {boolean} [parts.isVerified]        DoctorProfile.isVerified
 * @param {string} [parts.about]              DoctorProfile.about (обрежется)
 * @param {string|null} [parts.country]       DoctorProfile.country
 * @param {string} [parts.role]               ClinicMembership.role (doctor/owner/admin)
 * @returns {Object} безопасный публичный объект врача
 */
export function toPublicDoctorDTO(parts = {}) {
  const {
    userId,
    firstName = "",
    lastName = "",
    profileImage = null,
    specialization = null,
    isVerified = false,
    about = "",
    country = null,
    role = "doctor",
  } = parts;

  const fullName = [firstName, lastName]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join(" ");

  return {
    userId: userId ? String(userId) : null,
    name: fullName,
    profileImage: profileImage || null,
    specialization: specialization || null,
    isVerified: Boolean(isVerified),
    about: shortAbout(about),
    country: country || null,
    role,
    // ссылка на публичный профиль врача (паттерн фронта: /doctor/:userId)
    profileUrl: userId ? `/doctor/${String(userId)}` : null,
  };
}

/**
 * Публичная галерея: сортировка по order, безопасный whitelist.
 * @param {Array} gallery
 * @returns {Array<{id:string,url:string,caption:string}>}
 */
function toPublicGallery(gallery) {
  if (!Array.isArray(gallery)) return [];
  return gallery
    .filter((g) => g && g.url)
    .slice() // не мутируем исходный массив
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((g) => ({
      id: g._id ? String(g._id) : null,
      url: g.url, // этап B: резолв R2-ключ → CDN
      caption: g.caption || "",
    }));
}

/**
 * Публичные контакты клиники (только то, что клиника явно показывает).
 * @param {Object} contacts
 */
function toPublicContacts(contacts) {
  const c = contacts || {};
  return {
    phone: c.phone || null,
    email: c.email || null,
    website: c.website || null,
  };
}

/**
 * Публичный адрес: страна/город/улица. БЕЗ coordinates и postalCode.
 * @param {Object} address
 */
function toPublicAddress(address) {
  const a = address || {};
  return {
    country: a.country || null,
    city: a.city || null,
    street: a.street || null,
  };
}

/**
 * Публичные публикации: безопасный whitelist превью-полей.
 * Агрегат уже собран в clinic-publications.service.js — здесь только
 * страховочный проход (на случай мусорных элементов).
 * @param {Array} publications
 * @returns {Array}
 */
function toPublicPublications(publications) {
  if (!Array.isArray(publications)) return [];
  return publications
    .filter((p) => p && p.id && p.title)
    .map((p) => ({
      id: String(p.id),
      title: p.title || "",
      abstract: p.abstract || "",
      imageUrl: p.imageUrl || null,
      authorName: p.authorName || "",
      readTime: typeof p.readTime === "number" ? p.readTime : 0,
      views: typeof p.views === "number" ? p.views : 0,
      createdAt: p.createdAt || null,
      url: p.url || (p.id ? `/public/articles/${String(p.id)}` : null),
    }));
}

/**
 * Публичный DTO клиники для гостевой страницы /clinic/:slug.
 * Whitelist вручную. Врачи/отзывы/публикации передаются уже собранными.
 *
 * @param {Object} clinic            Mongoose-документ Clinic (lean или doc)
 * @param {Array}  [doctors=[]]      массив результатов toPublicDoctorDTO()
 * @param {Object} [reviews=null]    агрегат отзывов { ratingAvg, ratingCount, items }
 * @param {Array}  [publications=[]] массив превью-DTO публикаций
 * @returns {Object} безопасный публичный объект клиники
 */
export function toPublicClinicDTO(
  clinic,
  doctors = [],
  reviews = null,
  publications = [],
) {
  if (!clinic) return null;

  return {
    // identity
    name: clinic.name || "",
    slug: clinic.slug || "",
    isVerified: Boolean(clinic.isVerified),

    // brand
    logo: clinic.logo || null, // этап B: резолв R2-ключ → CDN
    description: clinic.description || "",
    gallery: toPublicGallery(clinic.gallery),

    // location (без координат и индекса)
    address: toPublicAddress(clinic.address),

    // what they do
    specializations: Array.isArray(clinic.specializations)
      ? clinic.specializations
      : [],

    // public contacts
    contacts: toPublicContacts(clinic.contacts),

    // people (только врачи/owner/admin actorType=user)
    doctors: Array.isArray(doctors) ? doctors : [],

    // этап C — отзывы (агрегат уже собран в сервисе)
    rating: {
      avg: reviews?.ratingAvg ?? 0,
      count: reviews?.ratingCount ?? 0,
    },
    reviews: Array.isArray(reviews?.items) ? reviews.items : [],

    // этап D — публикации врачей клиники (агрегат уже собран в сервисе)
    publications: toPublicPublications(publications),
  };
}
