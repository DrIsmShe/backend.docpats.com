// server/modules/simulation/controllers/duplicatePlanController.js
import { duplicatePlan } from "../services/simulationPlan.service.js";

/* ──────────────────────────────────────────────────────────────────────────
   POST /api/simulation/plans/:id/duplicate

   Body: { label? } — опционально переопределить имя копии.
   Если не задан, сервис добавит " (copy)" к оригинальному.

   Фото у копии shared по R2 (см. комментарий в simulationPlan.service).
   ────────────────────────────────────────────────────────────────────────── */
export async function duplicatePlanController(req, res) {
  try {
    const plan = await duplicatePlan(req.doctorId, req.params.id, {
      newLabel: req.body?.label,
    });

    if (!plan) {
      return res.status(404).json({
        error: "not_found",
        message: "Plan not found",
      });
    }

    return res.status(201).json({ plan });
  } catch (err) {
    console.error("[simulation/duplicatePlan] Failed:", err);
    return res.status(500).json({
      error: "internal_error",
      message: "Failed to duplicate plan",
    });
  }
}
