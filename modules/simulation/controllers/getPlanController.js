// server/modules/simulation/controllers/getPlanController.js
import { getPlanById } from "../services/simulationPlan.service.js";

/* ──────────────────────────────────────────────────────────────────────────
   GET /api/simulation/plans/:id

   Важно: 404 и при "не существует", и при "существует, но чужой/удалён".
   Не раскрываем сам факт существования чужих объектов.
   ────────────────────────────────────────────────────────────────────────── */
export async function getPlanController(req, res) {
  try {
    const plan = await getPlanById(req.doctorId, req.params.id);

    if (!plan) {
      return res.status(404).json({
        error: "not_found",
        message: "Plan not found",
      });
    }

    return res.json({ plan });
  } catch (err) {
    console.error("[simulation/getPlan] Failed:", err);
    return res.status(500).json({
      error: "internal_error",
      message: "Failed to fetch plan",
    });
  }
}
