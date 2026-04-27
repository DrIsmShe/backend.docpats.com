// server/modules/simulation/controllers/updatePlanController.js
import { updatePlan } from "../services/simulationPlan.service.js";

/* ──────────────────────────────────────────────────────────────────────────
   PATCH /api/simulation/plans/:id

   Body: частичный объект { label?, patientRef?, controlPoints? }.
   Валидатор гарантирует что пришло хотя бы одно поле.

   Используется в том числе для autosave controlPoints с клиента (S.4,
   debounced 2s).
   ────────────────────────────────────────────────────────────────────────── */
export async function updatePlanController(req, res) {
  try {
    const plan = await updatePlan(req.doctorId, req.params.id, req.body);

    if (!plan) {
      return res.status(404).json({
        error: "not_found",
        message: "Plan not found",
      });
    }

    return res.json({ plan });
  } catch (err) {
    console.error("[simulation/updatePlan] Failed:", err);
    return res.status(500).json({
      error: "internal_error",
      message: "Failed to update plan",
    });
  }
}
