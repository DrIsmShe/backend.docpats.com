// server/modules/simulation/controllers/landmarksController.js
//
// HTTP endpoints для landmarks:
//   PUT    /simulation/plans/:id/landmarks  — сохранить
//   DELETE /simulation/plans/:id/landmarks  — очистить

import { saveLandmarks, clearLandmarks } from "../services/landmarksService.js";

const CODE_TO_STATUS = {
  invalid_id: 400,
  invalid_payload: 400,
  forbidden: 403,
  not_found: 404,
};

function handleError(err, res) {
  const status = CODE_TO_STATUS[err.code] || 500;
  if (status === 500) {
    // eslint-disable-next-line no-console
    console.error("[landmarksController] unexpected error:", err);
  }
  res.status(status).json({
    error: err.code || "internal_error",
    message: status === 500 ? "Internal server error" : err.message,
  });
}

export async function putLandmarksController(req, res) {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const { id: planId } = req.params;
    const { landmarks, meta } = req.body || {};

    const plan = await saveLandmarks({
      planId,
      userId,
      landmarks,
      meta,
    });

    res.json(plan);
  } catch (err) {
    handleError(err, res);
  }
}

export async function deleteLandmarksController(req, res) {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const { id: planId } = req.params;
    const plan = await clearLandmarks({ planId, userId });
    res.json(plan);
  } catch (err) {
    handleError(err, res);
  }
}
