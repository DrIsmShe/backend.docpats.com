// server/modules/clinic/clinic-public/clinic-public-publication.service.js
//
// ВИТРИНА — публикация врача В КОНТЕКСТЕ КЛИНИКИ:
//   GET /api/v1/public/clinics/:slug/publications/:id
//
// Тот же мотив, что у профиля врача: детейл статьи существовал только по
// адресам платформы (/public/doctor-profile/article-detail-for-all/:id и
// /public/doctor/article-scientific-detail-for-all/:id), и блок «Публикации»
// уводил посетителя с сайта клиники — в отдельную вкладку, к чужой шапке.
//
// Здесь клиника резолвится по слагу, из неё — userId её врачей, и только среди
// их статей ищется запрошенная. Статья чужого врача по адресу клиники не
// откроется.

import {
  buildDoctorList,
  findPublishedClinicBySlug,
} from "./clinic-public.service.js";
import { getClinicPublicationDetail } from "./clinic-publications.service.js";

/**
 * Публичная публикация врача клиники.
 *
 * @param {string} slug слаг клиники
 * @param {string} publicationId Article._id или ArticleScine._id
 * @returns {Promise<Object|null>} DTO публикации или null
 */
export async function getPublicClinicPublication(slug, publicationId) {
  const clinic = await findPublishedClinicBySlug(slug);
  if (!clinic) return null;

  const doctors = await buildDoctorList(clinic._id);
  if (!doctors.length) return null;

  const doctorUserIds = doctors.map((d) => d.userId).filter(Boolean);

  const publication = await getClinicPublicationDetail(
    doctorUserIds,
    publicationId,
  );
  if (!publication) return null;

  // Клиника в DTO — по той же причине, что и у врача: edge-функция указывает
  // её издателем статьи, и второй запрос за клиникой ей не нужен.
  return {
    ...publication,
    clinic: { name: clinic.name || "", slug: clinic.slug || "" },
  };
}
