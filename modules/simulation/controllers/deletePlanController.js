// server/modules/simulation/controllers/deletePlanController.js
import { deletePlan } from "../services/simulationPlan.service.js";

/* ──────────────────────────────────────────────────────────────────────────
   DELETE /api/simulation/plans/:id

   Soft delete в БД, hard delete фото в R2 (если не шарится с другими
   планами через duplicate). Возвращаем 200 с удалённым объектом — клиенту
   удобно для undo-UX и логирования.

   Идемпотентность: повторный delete не упадёт — findOneAndUpdate молча
   обновит уже удалённый документ тем же deletedAt, R2-операция уже
   прошла (skip из-за отсутствия file).
   ────────────────────────────────────────────────────────────────────────── */
export async function deletePlanController(req, res) {
  try {
    const plan = await deletePlan(req.doctorId, req.params.id);

    if (!plan) {
      return res.status(404).json({
        error: "not_found",
        message: "Plan not found",
      });
    }

    return res.json({ plan });
  } catch (err) {
    console.error("[simulation/deletePlan] Failed:", err);
    return res.status(500).json({
      error: "internal_error",
      message: "Failed to delete plan",
    });
  }
}
