// server/modules/previsit/controllers/previsit.controller.js
//
// Публичный контур опроса: пациент по подписанной ссылке.

import * as svc from "../services/previsit.service.js";
import { errorText } from "../../../common/i18n/index.js";
import {
  ValidationError,
  NotFoundError,
} from "../../../common/utils/errors.js";

function handleError(res, err) {
  if (err instanceof ValidationError) {
    return res.status(400).json({ success: false, message: errorText(err, res.req) });
  }
  if (err instanceof NotFoundError) {
    return res.status(404).json({ success: false, message: errorText(err, res.req) });
  }
  console.error("previsit:", err);
  return res.status(500).json({ success: false, message: "Server error" });
}

export async function getByTokenController(req, res) {
  try {
    const intake = await svc.getIntakeByToken(req.params.token);
    return res.json({ success: true, intake });
  } catch (err) {
    return handleError(res, err);
  }
}

export async function submitController(req, res) {
  try {
    const out = await svc.submitIntake({
      token: req.params.token,
      answers: req.body?.answers || {},
      language: req.body?.language || "ru",
    });
    return res.json({ success: true, ...out });
  } catch (err) {
    return handleError(res, err);
  }
}

export default { getByTokenController, submitController };
