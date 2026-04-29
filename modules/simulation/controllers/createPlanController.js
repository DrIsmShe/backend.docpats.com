// server/modules/simulation/controllers/createPlanController.js
//
// S.7.7+ — Перезаписываем photo.url на canonical CDN URL перед сохранением
// в БД. Frontend получает proxy URL от uploadPhotoController, но в БД
// нужно хранить настоящий R2 URL чтобы:
//   1. БД оставалась чистой (proxy URL — runtime artifact)
//   2. Surgery worker и другие internal consumers могли работать с CDN
//   3. Откат на CDN был тривиальным (одна строка в serializePlan)

import { createPlan } from "../services/simulationPlan.service.js";
import { deletePhotoObject } from "../services/upload.service.js";
import { publicUrlFor } from "../config/r2.js";

export async function createPlanController(req, res) {
  const { label, patientRef, photo, controlPoints } = req.body;

  // S.7.7+ — Заменяем proxy URL на canonical CDN URL для БД.
  // photo.r2Key — источник истины, всё остальное производное.
  const photoForDb = photo
    ? {
        ...photo,
        url: photo.r2Key ? publicUrlFor(photo.r2Key) : photo.url,
      }
    : photo;

  try {
    const plan = await createPlan(req.doctorId, {
      label,
      patientRef,
      photo: photoForDb,
      controlPoints,
    });
    return res.status(201).json({ plan });
  } catch (err) {
    console.error("[simulation/createPlan] Failed:", err);

    if (photoForDb?.r2Key) {
      deletePhotoObject(photoForDb.r2Key).catch(() => {});
    }

    return res.status(500).json({
      error: "internal_error",
      message: "Failed to create plan",
    });
  }
}
