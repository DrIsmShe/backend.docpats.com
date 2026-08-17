// server/modules/clinic/clinic-medical/controllers/fhirExport.controller.js
//
// GET /clinic/medical/patients/:patientId/fhir
//
// Отдаёт Bundle с правильным Content-Type: принимающая сторона обычно
// смотрит именно на него, а не на расширение файла.

import * as svc from "../services/fhir/fhirExport.service.js";
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
  console.error("fhirExport:", err);
  return res.status(500).json({ success: false, message: "Server error" });
}

export async function exportPatientFhirController(req, res) {
  try {
    // База для fullUrl. Берём из настроек, а не из заголовка Host:
    // подставленный клиентом Host попал бы в файл, который потом уедет
    // в другую систему как ссылка на нас.
    const baseUrl =
      (process.env.PUBLIC_API_URL || "https://backend.docpats.com").replace(
        /\/+$/,
        "",
      ) + "/api/v1/clinic/medical/fhir";

    const bundle = await svc.exportPatientAsFhir({
      patient: req.clinicPatient,
      baseUrl,
    });

    // Тип по спецификации FHIR. Отдельно ставим имя файла: браузер
    // иначе сохранит его как «fhir» без расширения.
    res.setHeader("Content-Type", "application/fhir+json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="patient-${req.params.patientId}-fhir.json"`,
    );
    return res.status(200).send(JSON.stringify(bundle, null, 2));
  } catch (err) {
    return handleError(res, err);
  }
}

export default { exportPatientFhirController };
