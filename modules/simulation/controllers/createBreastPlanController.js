// server/modules/simulation/controllers/createBreastPlanController.js
//
// S.8 — Контроллер создания breast simulation plan.
//
// Аналогичен createPlanController, но:
//   • Принимает дополнительные поля: photoView, anatomy, operation, calibration
//   • Использует createBreastPlan() из service (а не createPlan)
//   • photo.url перезаписывается на canonical CDN URL так же как в face

import { createBreastPlan } from "../services/simulationPlan.service.js";
import { deletePhotoObject } from "../services/upload.service.js";
import { publicUrlFor } from "../config/r2.js";

export async function createBreastPlanController(req, res) {
  const {
    label,
    patientRef,
    photo,
    photoView,
    anatomy,
    operation,
    calibration,
    controlPoints,
  } = req.body;

  // Канонический CDN URL в БД (как в face).
  const photoForDb = photo
    ? {
        ...photo,
        url: photo.r2Key ? publicUrlFor(photo.r2Key) : photo.url,
      }
    : photo;

  try {
    const plan = await createBreastPlan(req.doctorId, {
      label,
      patientRef,
      photo: photoForDb,
      photoView,
      anatomy,
      operation,
      calibration,
      controlPoints,
    });
    return res.status(201).json({ plan });
  } catch (err) {
    console.error("[simulation/createBreastPlan] Failed:", err);

    if (photoForDb?.r2Key) {
      deletePhotoObject(photoForDb.r2Key).catch(() => {});
    }

    return res.status(500).json({
      error: "internal_error",
      message: "Failed to create breast plan",
    });
  }
}
