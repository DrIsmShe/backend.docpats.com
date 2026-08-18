// server/modules/clinic/clinic-medical/controllers/patientSummary.controller.js
//
// GET /clinic/medical/patients/:patientId/summary
//
// Сводка пациента одним запросом. Собирается детерминированно из тех же
// сервисов, что и обычные списки — см. пояснение в patientSummary.service.js
// о том, почему модель к этому экрану не подпускается.

import * as svc from "../services/patientSummary.service.js";
import { saveScribeDraft } from "../../../scribe/services/scribeSave.service.js";
import {
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
  ValidationError,
} from "../../../../common/utils/errors.js";

function handleError(res, err) {
  // Повторное сохранение черновика — законный отказ с понятной
  // причиной, а не сбой сервера: врач должен прочитать «уже сохранён»,
  // а не «Server error».
  if (err instanceof ValidationError) {
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err instanceof ForbiddenError) {
    return res.status(403).json({ success: false, message: err.message });
  }
  if (err instanceof NotFoundError) {
    return res.status(404).json({ success: false, message: err.message });
  }
  if (err instanceof UnprocessableError) {
    return res.status(422).json({ success: false, message: err.message });
  }
  console.error("patientSummary:", err);
  return res.status(500).json({ success: false, message: "Server error" });
}

export async function getPatientSummaryController(req, res) {
  try {
    const summary = await svc.getPatientSummary({
      patient: req.clinicPatient,
    });
    return res.json({ success: true, summary });
  } catch (err) {
    return handleError(res, err);
  }
}

/**
 * POST /clinic/medical/patients/:patientId/from-scribe/:sessionId
 *
 * Сохранить черновик приёма, собранный из разговора, как запись карты.
 * Живёт здесь, а не в scribe-модуле: запись в карту требует контекста
 * аренды и проверки прав, которые появляются только за tenantMiddleware.
 */
export async function saveFromScribeController(req, res) {
  try {
    const encounter = await saveScribeDraft({
      sessionId: req.params.sessionId,
      patient: req.clinicPatient,
      body: req.body || {},
    });
    return res.status(201).json({ success: true, encounter });
  } catch (err) {
    return handleError(res, err);
  }
}

export default { getPatientSummaryController, saveFromScribeController };
