// server/modules/simulation/controllers/listBreastGroupedController.js
//
// S.8 — Возвращает breast планы сгруппированные по пациенту.
// Полезно для UI: "все view одного пациента вместе".
//
// GET /api/simulation/breast/grouped
//   query:
//     limit          — макс. кол-во планов (default 100)
//     includeDeleted — включать deleted (default false)
//
// Response:
//   {
//     groups: [
//       {
//         patientRef: "John Doe",
//         plans: [
//           { id, planType, photoView, photo, ... },
//           ...
//         ]
//       },
//       ...
//     ]
//   }

import { listBreastPlansGroupedByPatient } from "../services/simulationPlan.service.js";

export async function listBreastGroupedController(req, res) {
  const { limit, includeDeleted } = req.query || {};

  try {
    const groups = await listBreastPlansGroupedByPatient(req.doctorId, {
      limit: limit ? parseInt(limit, 10) : 100,
      includeDeleted: includeDeleted === "true",
    });

    return res.json({ groups });
  } catch (err) {
    console.error("[simulation/listBreastGrouped] Failed:", err);
    return res.status(500).json({
      error: "internal_error",
      message: "Failed to list breast plans",
    });
  }
}
