// server/modules/clinic/clinic-public/clinic-public.service.js
//
// Clinic-as-Brand (этап A→D) + ВИТРИНА 2.0 (V4.2) — сервис гостевой страницы
// /clinic/:slug.
//
// Работает БЕЗ tenant-контекста и БЕЗ авторизации (публичный эндпоинт):
//   - Clinic     — softDelete-плагин, не tenant-scoped → findOne по slug ок
//   - ClinicMembership — clinicId объявлен вручную, tenant-плагина НЕТ →
//                  skipTenantScope не требуется
//   - ClinicDepartment — clinicId вручную, tenant-плагина НЕТ → фильтруем явно
//   - ClinicService   — clinicId вручную, tenant-плагина НЕТ → фильтруем явно
//   - User / DoctorProfile / Specialization — общие модели, не tenant-scoped
//
// Сборка врача повторяет проверенный паттерн AllDoctorController:
//   - имена: userDoc.decryptFields() → { firstName, lastName }
//   - специализация: User.specialization → Specialization (fallback profile.specialty)
//   - фото: profile.profileImage || user.avatar → normalizeImageUrl(R2_PUBLIC_URL)
//   - опыт: текущий год − specializationEndYear (fallback educationEndYear).
//           Явного поля опыта в DoctorProfile нет — выводим эвристикой (V4: поле).
//
// Этап C — отзывы (агрегат в clinic-reviews/services/review.service.js).
// Этап D — публикации врачей клиники (агрегат в clinic-publications.service.js).
// V4.2   — отделения (источник для блока bento): активные, без системного.
// V4.2   — услуги (прайс): активные, без системных, по order.

import Clinic from "../clinic-core/models/clinic.model.js";
import ClinicMembership from "../clinic-staff/models/clinicMembership.model.js";
import ClinicDepartment from "../clinic-departments/models/clinicDepartment.model.js";
import ClinicService from "../clinic-services/models/clinicService.model.js";
import ClinicCustomPage from "../clinic-pages/models/clinicCustomPage.model.js";
import ClinicArticle from "../clinic-articles/models/clinicArticle.model.js";
import ClinicGalleryItem from "../clinic-gallery/models/clinicGalleryItem.model.js";
import Article from "../../../common/models/Articles/articles.js";
import ArticleScine from "../../../common/models/Articles/articles-scince.js";
import User from "../../../common/models/Auth/users.js";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import Specialization from "../../../common/models/DoctorProfile/specialityOfDoctor.js";
import { getPublicReviewsAggregate } from "../clinic-reviews/services/review.service.js";
import { getClinicPublicationsByDoctorIds } from "./clinic-publications.service.js";
import {
  toPublicClinicDTO,
  toPublicDoctorDTO,
  toPublicCustomPageDTO,
  toPublicArticleCard,
  toPublicArticleDetail,
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
 * Стаж врача (лет). В DoctorProfile нет явного поля опыта — выводим из года
 * окончания специализации (fallback — года окончания образования):
 *   опыт = текущий_год − specializationEndYear || educationEndYear
 * Возвращает положительное целое в разумных пределах (1..70), иначе null.
 * @param {Object} profile lean DoctorProfile
 * @returns {number|null}
 */
function computeExperienceYears(profile) {
  const base = profile?.specializationEndYear || profile?.educationEndYear;
  const baseYear = Number(base);
  if (!Number.isFinite(baseYear) || baseYear <= 0) return null;
  const years = new Date().getFullYear() - baseYear;
  if (!Number.isFinite(years) || years <= 0 || years > 70) return null;
  return years;
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
  //    + года окончания специализации/образования — для вывода стажа.
  const profiles = await DoctorProfile.find({ userId: { $in: userIds } })
    .select(
      "userId profileImage isVerified about country specialty specializationEndYear educationEndYear",
    )
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
        doctorProfileId: String(profile._id),
        firstName,
        lastName,
        profileImage,
        specialization,
        isVerified: profile.isVerified,
        about: profile.about,
        country: profile.country,
        experienceYears: computeExperienceYears(profile),
        role: roleByUser.get(key) || "doctor",
      }),
    );
  }

  return result;
}

/**
 * ВИТРИНА 2.0 (V4.2) — активные отделения клиники для блока bento.
 * Системное «General» (isSystem) скрываем — это техническое дефолтное.
 * Плоско (включая под-отделения), по алфавиту. Whitelist полей — в маппере.
 *
 * @param {import("mongoose").Types.ObjectId|string} clinicId
 * @returns {Promise<Array>} lean-отделения
 */
async function buildDepartmentList(clinicId) {
  return ClinicDepartment.find({
    clinicId,
    status: "active",
    isSystem: { $ne: true },
  })
    .select("name description specialty code")
    .sort({ name: 1 })
    .lean();
}

/**
 * ВИТРИНА 2.0 (V4.2) — активные услуги клиники (прайс для блока bento/услуг).
 * Системные (isSystem) скрываем. Порядок: order (затем имя). Привязка к
 * отделению (departmentId) идёт в DTO — фронт группирует по departments[].id.
 * Whitelist полей и нормализация цены — в маппере (toPublicServices).
 *
 * @param {import("mongoose").Types.ObjectId|string} clinicId
 * @returns {Promise<Array>} lean-услуги
 */
async function buildServiceList(clinicId) {
  return ClinicService.find({
    clinicId,
    status: "active",
    isSystem: { $ne: true },
  })
    .select(
      "name description departmentId priceType price priceMax currency durationMinutes order",
    )
    .sort({ order: 1, name: 1 })
    .lean();
}

// ВИТРИНА 2.0 (Часть 2) — опубликованные кастомные страницы клиники (для меню).
// ClinicCustomPage tenant-scoped, но публичный сервис вне tenant-контекста →
// фильтруем clinicId явно (как departments). isDeleted отсеивается плагином/
// индексом; добавляем явно на случай отсутствия мидлвара.
async function buildCustomPagesList(clinicId) {
  return ClinicCustomPage.find({
    clinicId,
    status: "published",
    isDeleted: { $ne: true },
  })
    .select("slug title order parentId")
    .sort({ order: 1, createdAt: 1 })
    .lean();
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

  // Врачи, отзывы, отделения, услуги и кастомные страницы — параллельно
  const [doctors, reviews, departments, services, customPages] =
    await Promise.all([
      buildDoctorList(clinic._id),
      getPublicReviewsAggregate(clinic._id, { limit: 20 }),
      buildDepartmentList(clinic._id),
      buildServiceList(clinic._id),
      buildCustomPagesList(clinic._id),
    ]);

  // Этап D — публикации: зависят от userId врачей, поэтому после buildDoctorList
  const doctorUserIds = doctors.map((d) => d.userId).filter(Boolean);
  const publications = await getClinicPublicationsByDoctorIds(doctorUserIds, {
    limit: 6,
  });

  return toPublicClinicDTO(
    clinic,
    doctors,
    reviews,
    publications,
    departments,
    customPages,
    services,
  );
}

/**
 * Публичный контент одной кастомной страницы по (slug клиники, slug страницы).
 * Возвращает null, если клиника/страница не найдены или не опубликованы.
 * @param {string} slug      slug клиники
 * @param {string} pageSlug  slug кастомной страницы
 * @returns {Promise<Object|null>} { slug, title, seo, layout:{blocks} } | null
 */
export async function getPublicCustomPage(slug, pageSlug) {
  if (!slug || typeof slug !== "string") return null;
  if (!pageSlug || typeof pageSlug !== "string") return null;

  const normalizedClinic = slug.trim().toLowerCase();
  const normalizedPage = pageSlug.trim().toLowerCase();
  if (!normalizedClinic || !normalizedPage) return null;

  // 1) клиника должна существовать и быть опубликованной
  const clinic = await Clinic.findOne({
    slug: normalizedClinic,
    isPublished: true,
    isActive: true,
  })
    .select("_id")
    .lean();
  if (!clinic) return null;

  // 2) страница — опубликованная, в рамках этой клиники
  const page = await ClinicCustomPage.findOne({
    clinicId: clinic._id,
    slug: normalizedPage,
    status: "published",
    isDeleted: { $ne: true },
  }).lean();
  if (!page) return null;

  return toPublicCustomPageDTO(page);
}

// ───────────────────────────────────────────────────────────────────────────
// ВИТРИНА 2.0 (Часть 3) — публичная отдача статей клиники.
// Видны только: status==="published" И moderation!=="disabled" (рубильник проекта).
// ───────────────────────────────────────────────────────────────────────────

// Резолв опубликованной клиники + опубликованной страницы-категории по слагам.
// Возвращает { clinic, page } или null.
async function resolveClinicAndPage(slug, pageSlug) {
  if (!slug || !pageSlug) return null;
  const nClinic = String(slug).trim().toLowerCase();
  const nPage = String(pageSlug).trim().toLowerCase();
  if (!nClinic || !nPage) return null;

  const clinic = await Clinic.findOne({
    slug: nClinic,
    isPublished: true,
    isActive: true,
  })
    .select("_id")
    .lean();
  if (!clinic) return null;

  const page = await ClinicCustomPage.findOne({
    clinicId: clinic._id,
    slug: nPage,
    status: "published",
    isDeleted: { $ne: true },
  })
    .select("_id slug title")
    .lean();
  if (!page) return null;

  return { clinic, page };
}

/**
 * Список карточек статей категории (превью).
 * @returns {Promise<Array|null>} массив карточек или null (клиника/страница не найдены)
 */
export async function getPublicCategoryArticles(slug, pageSlug) {
  const ctx = await resolveClinicAndPage(slug, pageSlug);
  if (!ctx) return null;

  const articles = await ClinicArticle.find({
    clinicId: ctx.clinic._id,
    pageId: ctx.page._id,
    status: "published",
    moderation: { $ne: "disabled" },
    isDeleted: { $ne: true },
  })
    .select("slug title excerpt cover authors order createdAt")
    .sort({ order: 1, createdAt: -1 })
    .lean();

  return articles.map(toPublicArticleCard);
}

/**
 * ВИТРИНА 2.0 (Часть 6) — агрегат статей РОДИТЕЛЬСКОЙ категории:
 * все опубликованные статьи всех её подкатегорий.
 * @returns {Promise<{ articles: Array, subcategories: Array }|null>}
 *   null — клиника/страница не найдены. Если у страницы нет подкатегорий —
 *   subcategories пустой, articles пустой (родитель без детей).
 */
export async function getPublicParentArticles(slug, pageSlug) {
  const ctx = await resolveClinicAndPage(slug, pageSlug);
  if (!ctx) return null;

  // подкатегории этой страницы (опубликованные)
  const children = await ClinicCustomPage.find({
    clinicId: ctx.clinic._id,
    parentId: ctx.page._id,
    status: "published",
    isDeleted: { $ne: true },
  })
    .select("slug title order")
    .sort({ order: 1, createdAt: 1 })
    .lean();

  const subcategories = children.map((c) => ({
    id: String(c._id),
    slug: c.slug,
    title: c.title,
  }));

  if (!children.length) {
    return { articles: [], subcategories: [] };
  }

  const childIds = children.map((c) => c._id);
  const childTitleById = new Map(children.map((c) => [String(c._id), c.title]));
  const childSlugById = new Map(children.map((c) => [String(c._id), c.slug]));

  // статьи всех подкатегорий
  const articles = await ClinicArticle.find({
    clinicId: ctx.clinic._id,
    pageId: { $in: childIds },
    status: "published",
    moderation: { $ne: "disabled" },
    isDeleted: { $ne: true },
  })
    .select("slug title excerpt cover authors order createdAt pageId")
    .sort({ createdAt: -1 })
    .lean();

  // карточки + к какой подкатегории относится (для ссылки и бейджа)
  const cards = articles.map((a) => {
    const card = toPublicArticleCard(a);
    const pid = String(a.pageId);
    return {
      ...card,
      categorySlug: childSlugById.get(pid) || "",
      categoryTitle: childTitleById.get(pid) || "",
    };
  });

  return { articles: cards, subcategories };
}
export async function getPublicArticleDetail(slug, pageSlug, articleSlug) {
  const ctx = await resolveClinicAndPage(slug, pageSlug);
  if (!ctx) return null;

  const nArticle = String(articleSlug || "")
    .trim()
    .toLowerCase();
  if (!nArticle) return null;

  const article = await ClinicArticle.findOne({
    clinicId: ctx.clinic._id,
    pageId: ctx.page._id,
    slug: nArticle,
    status: "published",
    moderation: { $ne: "disabled" },
    isDeleted: { $ne: true },
  }).lean();
  if (!article) return null;

  return toPublicArticleDetail(article, ctx.page);
}

/**
 * Публичная галерея категории — фото с подписями.
 * @returns {Promise<Array|null>} массив фото или null (клиника/страница не найдены)
 */
export async function getPublicCategoryGallery(slug, pageSlug) {
  const ctx = await resolveClinicAndPage(slug, pageSlug);
  if (!ctx) return null;

  const items = await ClinicGalleryItem.find({
    clinicId: ctx.clinic._id,
    pageId: ctx.page._id,
    isDeleted: { $ne: true },
  })
    .select("image caption description order")
    .sort({ order: 1, createdAt: 1 })
    .lean();

  return items.map((it) => ({
    id: String(it._id),
    image: it.image,
    caption: it.caption || "",
    description: it.description || "",
  }));
}
