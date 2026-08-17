// server/modules/clinic/clinic-medical/controllers/patientSummary.controller.js
//
// GET /clinic/medical/patients/:patientId/summary
//
// Сводка пациента одним запросом. Собирается детерминированно из тех же
// сервисов, что и обычные списки — см. пояснение в patientSummary.service.js
// о том, почему модель к этому экрану не подпускается.

import * as svc from "../services/patientSummary.service.js";
import {
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from "../../../../common/utils/errors.js";

function handleError(res, err) {
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

export default { getPatientSummaryController };
