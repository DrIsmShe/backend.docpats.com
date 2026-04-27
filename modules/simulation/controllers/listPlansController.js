// server/modules/simulation/controllers/listPlansController.js
import { listPlans } from "../services/simulationPlan.service.js";

/* ──────────────────────────────────────────────────────────────────────────
   GET /api/simulation/plans?limit=30&cursor=<id>&includeDeleted=false
   ────────────────────────────────────────────────────────────────────────── */
export async function listPlansController(req, res) {
  try {
    const { limit, cursor, includeDeleted } = req.query;

    const result = await listPlans(req.doctorId, {
      limit,
      cursor,
      includeDeleted,
    });

    return res.json(result);
  } catch (err) {
    console.error("[simulation/listPlans] Failed:", err);
    return res.status(500).json({
      error: "internal_error",
      message: "Failed to list plans",
    });
  }
}
