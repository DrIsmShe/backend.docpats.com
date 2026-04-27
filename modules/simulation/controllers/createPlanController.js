// server/modules/simulation/controllers/createPlanController.js
import { createPlan } from "../services/simulationPlan.service.js";
import { deletePhotoObject } from "../services/upload.service.js";

/* ──────────────────────────────────────────────────────────────────────────
   POST /api/simulation/plans

   Body: { label, patientRef?, photo, controlPoints? }
   — photo приходит из предыдущего POST /photos шага.

   Компенсация: если create упал (например, Mongo отвалился между upload'ом
   и этим роутом), оставить orphan фото в R2 плохо. Пытаемся удалить. Не
   throw'им если cleanup тоже упал — это уже лучше логов.
   ────────────────────────────────────────────────────────────────────────── */
export async function createPlanController(req, res) {
  const { label, patientRef, photo, controlPoints } = req.body;

  try {
    const plan = await createPlan(req.doctorId, {
      label,
      patientRef,
      photo,
      controlPoints,
    });
    return res.status(201).json({ plan });
  } catch (err) {
    console.error("[simulation/createPlan] Failed:", err);

    // Orphan cleanup: план не создан — фото в R2 болтается без владельца.
    if (photo?.r2Key) {
      deletePhotoObject(photo.r2Key).catch(() => {});
    }

    return res.status(500).json({
      error: "internal_error",
      message: "Failed to create plan",
    });
  }
}
