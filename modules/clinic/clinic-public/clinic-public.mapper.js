// server/modules/clinic/clinic-public/clinic-public.mapper.js
//
// Clinic-as-Brand (этап A→D) + ВИТРИНА 2.0 (V0, V4.1, V4.2) — публичные DTO
// для гостевой страницы /clinic/:slug.
//
// ПРИНЦИП БЕЗОПАСНОСТИ: наружу отдаём ТОЛЬКО явно перечисленные поля (whitelist).
// НЕ используем clinic.toJSON()/doc.toObject() — иначе приватные поля
// (legalName, taxId, ownerId, coordinates, tier, metadata, internal flags)
// рискуют утечь. Каждое поле копируем руками.
//
// Мапперы ПОЛНОСТЬЮ ЧИСТЫЕ: ни БД, ни decrypt, ни env.
//  - decrypt имён врача/автора и сборку источников делает сервис
//  - публикации приходят уже как массив превью-DTO из clinic-publications.service.js
//  - resolveTheme + defaultLayoutBlocks — чистые функции (без БД/запросов):
//    resolveTheme маппит ключи темы → CSS-переменные; defaultLayoutBlocks даёт
//    fallback-раскладку для старых клиник, у которых layout нет в БД (lean НЕ
//    применяет дефолты схемы — см. ниже toPublicLayout).

import { resolveTheme } from "../clinic-core/themePresets.js";
import { defaultLayoutBlocks } from "../clinic-core/models/clinic.model.js";

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
 * @param {string} parts.userId               User._id (нужен для агрегата публикаций)
 * @param {string} [parts.doctorProfileId]    DoctorProfile._id (для ссылки на профиль!)
 * @param {string} [parts.firstName]          расшифровано в сервисе
 * @param {string} [parts.lastName]           расшифровано в сервисе
 * @param {string|null} [parts.profileImage]  DoctorProfile.profileImage
 * @param {string|null} [parts.specialization] имя из Specialization (после populate)
 * @param {boolean} [parts.isVerified]        DoctorProfile.isVerified
 * @param {string} [parts.about]              DoctorProfile.about (обрежется)
 * @param {string|null} [parts.country]       DoctorProfile.country
 * @param {number|null} [parts.experienceYears] стаж в годах (выведен в сервисе)
 * @param {string} [parts.role]               ClinicMembership.role (doctor/owner/admin)
 * @returns {Object} безопасный публичный объект врача
 */
export function toPublicDoctorDTO(parts = {}) {
  const {
    userId,
    doctorProfileId = null,
    firstName = "",
    lastName = "",
    profileImage = null,
    specialization = null,
    isVerified = false,
    about = "",
    country = null,
    experienceYears = null,
    role = "doctor",
  } = parts;

  const fullName = [firstName, lastName]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join(" ");

  return {
    // userId нужен наружу для агрегата публикаций (clinic-public.service.js:286
    // делает doctors.map((d) => d.userId)). НЕ убирать.
    userId: userId ? String(userId) : null,
    name: fullName,
    profileImage: profileImage || null,
    specialization: specialization || null,
    isVerified: Boolean(isVerified),
    about: shortAbout(about),
    country: country || null,
    experienceYears:
      Number.isFinite(experienceYears) && experienceYears > 0
        ? experienceYears
        : null,
    role,
    // ВАЖНО: публичный профиль ищется по doctorProfileId (DoctorProfile._id),
    // НЕ по userId. Эндпоинт /doctor-profile/doctor-detail/:id принимает
    // именно doctorProfileId — иначе "Doctor not found".
    profileUrl: doctorProfileId
      ? `/public/doctor-profile/doctor-details/${String(doctorProfileId)}`
      : null,
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
 * ВИТРИНА 2.0 (V4.1) — публичный FAQ клиники.
 * Фильтруем пустые (q и a обязаны быть непустыми). Whitelist q/a.
 * @param {Array} faq
 * @returns {Array<{q:string,a:string}>}
 */
function toPublicFaq(faq) {
  if (!Array.isArray(faq)) return [];
  return faq.filter((f) => f && f.q && f.a).map((f) => ({ q: f.q, a: f.a }));
}

/**
 * ВИТРИНА 2.0 (V4.2) — публичные отделения (источник для блока bento).
 * Сервис передаёт уже отфильтрованные (status: active) отделения. Здесь —
 * безопасный whitelist. specialty — стабильный ключ (лейбл/иконку даёт фронт).
 * @param {Array} departments
 * @returns {Array<{id:string|null,name:string,description:string,specialty:string|null,code:string|null}>}
 */
function toPublicDepartments(departments) {
  if (!Array.isArray(departments)) return [];
  return departments
    .filter((d) => d && d.name)
    .map((d) => ({
      id: d._id ? String(d._id) : d.id ? String(d.id) : null,
      name: d.name,
      description: d.description || "",
      specialty: d.specialty || null,
      code: d.code || null,
    }));
}

/**
 * ВИТРИНА 2.0 (V4.2) — публичные услуги клиники (прайс для блока bento/услуг).
 * Сервис передаёт уже отфильтрованные (status: active, не isSystem) услуги.
 * Здесь — безопасный whitelist + нормализация цены под priceType.
 *
 * Скрываем наружу: clinicId, branchId, isSystem, status, code (внутренние).
 * departmentId отдаём как строку — фронт группирует услуги по отделениям
 * (матчит с departments[].id).
 *
 * Цена нормализуется по типу:
 *   on_request/free → price/priceMax обнуляем (на витрине цифры не нужны),
 *   from            → priceMax обнуляем (граница одна),
 *   range           → оба значения (если priceMax задан),
 *   fixed           → price.
 * Валюта пустая → null; фронт подставит clinic.defaultCurrency.
 *
 * @param {Array} services lean-услуги из сервиса
 * @returns {Array<Object>}
 */
function toPublicServices(services) {
  if (!Array.isArray(services)) return [];

  const num = (v) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

  return services
    .filter((s) => s && s.name)
    .map((s) => {
      const priceType = s.priceType || "fixed";
      let price = num(s.price);
      let priceMax = num(s.priceMax);

      if (priceType === "on_request" || priceType === "free") {
        price = null;
        priceMax = null;
      } else if (priceType === "from" || priceType === "fixed") {
        priceMax = null;
      }
      // range — оба значения как есть

      return {
        id: s._id ? String(s._id) : s.id ? String(s.id) : null,
        name: s.name,
        description: s.description || "",
        departmentId: s.departmentId ? String(s.departmentId) : null,
        priceType,
        price,
        priceMax,
        currency: s.currency || null, // null → фронт берёт clinic.defaultCurrency
        durationMinutes: num(s.durationMinutes),
      };
    });
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
 * ВИТРИНА 2.0 — публичная блоковая раскладка.
 *
 * Логика fallback (ВАЖНО): сервис тянет клинику через .lean(), а lean НЕ
 * применяет дефолты схемы. Значит у старых клиник (созданных до V0) поля
 * layout в БД нет → layout?.blocks === undefined. Чтобы витрина не оказалась
 * пустой, при отсутствии блоков подставляем defaultLayoutBlocks().
 *
 * Различаем «не настроено» и «настроено, но всё скрыто»:
 *  - blocks отсутствует / пустой массив → клиника никогда не настраивала
 *    раскладку → fallback на дефолт.
 *  - blocks непустой (хоть один блок есть) → уважаем выбор владельца, даже
 *    если после фильтра visible:false ничего не осталось.
 *
 * Наружу отдаём только видимые блоки, отсортированные по order. Скрытые блоки
 * и их config НЕ светим. config видимого блока — это презентационные данные
 * (заголовки/ссылки), предназначенные для публичной страницы.
 *
 * @param {Object} layout  clinic.layout (может быть undefined у старых клиник)
 * @returns {{blocks: Array<{id:string|null,type:string,order:number,config:Object}>}}
 */
// ВИТРИНА 2.0 (Часть 2) — список кастомных страниц для меню (slug+title).
function toPublicCustomPages(pages) {
  if (!Array.isArray(pages)) return [];
  return pages
    .filter((p) => p && p.slug && p.title)
    .map((p) => ({
      id: String(p._id),
      parentId: p.parentId ? String(p.parentId) : null,
      slug: p.slug,
      title: p.title,
      order: typeof p.order === "number" ? p.order : 0,
    }));
}

// Блоки одной кастомной страницы (без fallback-дефолта — пустая остаётся пустой).
function toPublicPageBlocks(layout) {
  const raw = Array.isArray(layout?.blocks) ? layout.blocks : [];
  return raw
    .filter((b) => b && b.type && b.visible !== false)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((b) => ({
      id: b._id ? String(b._id) : null,
      type: b.type,
      order: typeof b.order === "number" ? b.order : 0,
      config: b.config && typeof b.config === "object" ? b.config : {},
    }));
}

/**
 * Публичный DTO одной кастомной страницы (контент для рендера по /dp/:pageSlug).
 * @param {Object} page документ ClinicCustomPage (lean)
 */
export function toPublicCustomPageDTO(page) {
  if (!page) return null;
  return {
    slug: page.slug || "",
    title: page.title || "",
    seo: {
      title: page.seo?.title || "",
      description: page.seo?.description || "",
    },
    layout: { blocks: toPublicPageBlocks(page.layout) },
  };
}

// ВИТРИНА 2.0 (Часть 3) — карточка статьи (превью для списка категории).
export function toPublicArticleCard(a) {
  if (!a) return null;
  return {
    slug: a.slug || "",
    title: a.title || "",
    excerpt: a.excerpt || "",
    cover: a.cover || "",
    authors: a.authors || "",
    createdAt: a.createdAt || null,
  };
}

// ВИТРИНА 2.0 (Часть 3) — детейл статьи (полный контент).
export function toPublicArticleDetail(a, page) {
  if (!a) return null;
  return {
    slug: a.slug || "",
    title: a.title || "",
    authors: a.authors || "",
    excerpt: a.excerpt || "",
    cover: a.cover || "",
    body: a.body || "",
    links: a.links || "",
    gallery: Array.isArray(a.gallery)
      ? a.gallery.map((g) => ({
          image: g.image || "",
          caption: g.caption || "",
          description: g.description || "",
        }))
      : [],
    tags: Array.isArray(a.tags) ? a.tags : [],
    metaDescription: a.metaDescription || "",
    metaKeywords: Array.isArray(a.metaKeywords) ? a.metaKeywords : [],
    createdAt: a.createdAt || null,
    // контекст категории для «хлебных крошек» / ссылки назад
    category: page ? { slug: page.slug || "", title: page.title || "" } : null,
  };
}

function toPublicLayout(layout) {
  const hasConfigured =
    Array.isArray(layout?.blocks) && layout.blocks.length > 0;
  const raw = hasConfigured ? layout.blocks : defaultLayoutBlocks();

  const blocks = raw
    .filter((b) => b && b.type && b.visible !== false)
    .slice() // не мутируем исходный массив
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((b) => ({
      // _id есть у блоков из БД; у fallback-дефолта его нет → null.
      // Фронт ключует по (id || type).
      id: b._id ? String(b._id) : null,
      type: b.type,
      order: typeof b.order === "number" ? b.order : 0,
      config: b.config && typeof b.config === "object" ? b.config : {},
    }));

  return { blocks };
}

/**
 * Публичный DTO клиники для гостевой страницы /clinic/:slug.
 * Whitelist вручную. Врачи/отзывы/публикации передаются уже собранными.
 *
 * @param {Object} clinic            Mongoose-документ Clinic (lean или doc)
 * @param {Array}  [doctors=[]]      массив результатов toPublicDoctorDTO()
 * @param {Object} [reviews=null]    агрегат отзывов { ratingAvg, ratingCount, items }
 * @param {Array}  [publications=[]] массив превью-DTO публикаций
 * @param {Array}  [departments=[]]  массив отделений (status:active) из сервиса
 * @param {Array}  [customPages=[]]  массив кастомных страниц (published) из сервиса
 * @param {Array}  [services=[]]     массив услуг (status:active) из сервиса (V4.2)
 * @returns {Object} безопасный публичный объект клиники
 */
export function toPublicClinicDTO(
  clinic,
  doctors = [],
  reviews = null,
  publications = [],
  departments = [],
  customPages = [],
  services = [],
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

    // ВИТРИНА 2.0 (V4.1) — brand-поля уровня клиники.
    // Приоритет «клиника > config блока» применяется на фронте (в блоках).
    coverImage: clinic.coverImage || null, // этап загрузки: R2-ключ → CDN
    pageBackground: clinic.pageBackground || null, // фон всей страницы (pageBgStyle:photo)
    slogan: clinic.slogan || "",
    callCenterPhone: clinic.callCenterPhone || null,
    callCenterHours: clinic.callCenterHours || "",
    faq: toPublicFaq(clinic.faq),

    // location (без координат и индекса)
    address: toPublicAddress(clinic.address),

    // what they do
    specializations: Array.isArray(clinic.specializations)
      ? clinic.specializations
      : [],

    // ВИТРИНА 2.0 (V4.2) — отделения (источник для bento). Сервис фильтрует active.
    departments: toPublicDepartments(departments),

    // ВИТРИНА 2.0 (V4.2) — услуги (прайс). Сервис фильтрует active, не isSystem.
    services: toPublicServices(services),

    // public contacts
    contacts: toPublicContacts(clinic.contacts),

    // ВИТРИНА 2.0 — оформление и блоковая раскладка.
    // theme: резолвнутые токены → фронт вешает cssVars инлайном на корневой div,
    // инжектит fontImportUrl, ветвит hero по heroStyle. Сырые ключи наружу НЕ идут.
    theme: resolveTheme(clinic.theme),
    layout: toPublicLayout(clinic.layout),

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

    // ВИТРИНА 2.0 (Часть 2) — кастомные страницы сайта (только опубликованные,
    // slug+title для меню/ссылок). Контент (layout.blocks) грузится отдельным
    // публичным эндпоинтом по /dp/:pageSlug.
    customPages: toPublicCustomPages(customPages),
  };
}
