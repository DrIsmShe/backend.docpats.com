// modules/clinic/clinic-core/controllers/clinicMedia.controller.js
//
// Clinic-as-Brand (этап B) — загрузка медиа клиники в R2 (docpats-media).
//
// uploadFile() сжимает изображения в webp и возвращает АБСОЛЮТНЫЙ CDN-URL
// (${R2_PUBLIC_URL}/uploads/images/<uuid>.webp), поэтому в модель пишем
// готовый URL — маппер (pass-through для http) уже работает, резолв не нужен.
//
// Guard'ы как в updateClinic: cross-tenant + can("clinic","write").
// Цепочка в роутере: upload → rebindTenantContext → controller (ALS после multer).

import Clinic from "../models/clinic.model.js";
import {
  uploadFile,
  deleteFile,
} from "../../../../common/middlewares/uploadMiddleware.js";
import {
  ForbiddenError,
  ValidationError,
  NotFoundError,
} from "../../../../common/utils/errors.js";
import { getCurrentClinicId } from "../../../../common/context/tenantContext.js";
import { can } from "../../../../common/auth/can.js";

const GALLERY_MAX = 20;

/** Общая проверка прав владельца на изменение своей клиники. */
function assertCanEdit(clinicIdParam) {
  const currentClinicId = getCurrentClinicId();
  if (String(currentClinicId) !== String(clinicIdParam)) {
    throw new ForbiddenError("Cannot modify another clinic");
  }
  if (!can("clinic", "write")) {
    throw new ForbiddenError("clinic.write permission required");
  }
}

/**
 * POST /api/v1/clinic/clinics/:id/logo
 * multipart, поле "logo" (один файл). Заменяет логотип, старый удаляет из R2.
 */
export async function uploadClinicLogo(req, res, next) {
  try {
    const { id } = req.params;
    assertCanEdit(id);

    if (!req.file) {
      throw new ValidationError("No logo file provided (field 'logo')");
    }

    const clinic = await Clinic.findById(id);
    if (!clinic) throw new NotFoundError("Clinic");

    const newUrl = await uploadFile(req.file); // абсолютный CDN-URL
    const oldUrl = clinic.logo;

    clinic.logo = newUrl;
    await clinic.save();

    // подчистить старый логотип (не блокируем ответ ошибкой удаления)
    if (oldUrl && oldUrl !== newUrl) {
      deleteFile(oldUrl).catch((e) =>
        console.warn("[clinic-media] old logo delete failed:", e?.message),
      );
    }

    res.json({ logo: clinic.logo });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/v1/clinic/clinics/:id/logo
 * Убрать логотип.
 */
export async function deleteClinicLogo(req, res, next) {
  try {
    const { id } = req.params;
    assertCanEdit(id);

    const clinic = await Clinic.findById(id);
    if (!clinic) throw new NotFoundError("Clinic");

    const oldUrl = clinic.logo;
    clinic.logo = null;
    await clinic.save();

    if (oldUrl) {
      deleteFile(oldUrl).catch((e) =>
        console.warn("[clinic-media] logo delete failed:", e?.message),
      );
    }

    res.json({ logo: null });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/clinic/clinics/:id/gallery
 * multipart, поле "images" (несколько). Добавляет фото в галерею.
 */
export async function uploadClinicGallery(req, res, next) {
  try {
    const { id } = req.params;
    assertCanEdit(id);

    const files = req.files || [];
    if (!files.length) {
      throw new ValidationError("No gallery files provided (field 'images')");
    }

    const clinic = await Clinic.findById(id);
    if (!clinic) throw new NotFoundError("Clinic");

    const current = Array.isArray(clinic.gallery) ? clinic.gallery : [];
    if (current.length + files.length > GALLERY_MAX) {
      throw new ValidationError(
        `Gallery limit is ${GALLERY_MAX} photos (have ${current.length}, adding ${files.length})`,
      );
    }

    // следующий order — после максимального текущего
    let nextOrder =
      current.reduce((max, g) => Math.max(max, g.order ?? 0), 0) + 1;

    const uploaded = [];
    for (const file of files) {
      const url = await uploadFile(file); // абсолютный CDN-URL
      uploaded.push({ url, caption: "", order: nextOrder++ });
    }

    clinic.gallery.push(...uploaded);
    await clinic.save();

    // вернуть свежую галерею (с _id новых элементов)
    res.json({
      gallery: clinic.gallery
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((g) => ({
          id: String(g._id),
          url: g.url,
          caption: g.caption || "",
          order: g.order ?? 0,
        })),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/v1/clinic/clinics/:id/gallery/:itemId
 * Удалить одно фото из галереи + из R2.
 */
export async function deleteClinicGalleryItem(req, res, next) {
  try {
    const { id, itemId } = req.params;
    assertCanEdit(id);

    const clinic = await Clinic.findById(id);
    if (!clinic) throw new NotFoundError("Clinic");

    const item = clinic.gallery.id(itemId);
    if (!item) throw new NotFoundError("Gallery item");

    const url = item.url;
    item.deleteOne(); // удалить сабдокумент
    await clinic.save();

    if (url) {
      deleteFile(url).catch((e) =>
        console.warn("[clinic-media] gallery delete failed:", e?.message),
      );
    }

    res.json({
      gallery: clinic.gallery
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((g) => ({
          id: String(g._id),
          url: g.url,
          caption: g.caption || "",
          order: g.order ?? 0,
        })),
    });
  } catch (err) {
    next(err);
  }
}
