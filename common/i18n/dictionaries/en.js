// common/i18n/dictionaries/en.js
//
// Сообщения сервера, которые видит человек. Ключ — код, значение —
// текст. Подстановки записываются как {{имя}}.
//
// English.

export default {
  "common.unauthorized": "Not authenticated",
  "common.forbidden": "Access denied",
  "common.notFound": "Not found",
  "common.badId": "Invalid identifier format",
  "common.serverError": "Internal server error",
  "common.tooManyRequests": "Too many attempts. Please try again later.",
  "common.validationFailed": "Please check the fields you filled in",
  "common.saveFailed": "Could not save",
  "common.deleteFailed": "Could not delete",
  "common.loadFailed": "Could not load the data",
  "patient.notFound": "Patient not found",
  "patient.required": "A patient must be specified",
  "clinic.notFound": "Clinic not found",
  "clinic.membershipRequired": "Clinic membership is required",
  "clinic.featureNotInPlan": "This section is included in the Business and Enterprise plans",
  "clinic.analyticsNotInPlan": "Clinic analytics is included in the Business and Enterprise plans",
  "prescription.notFound": "Prescription not found",
  "prescription.needsItem": "At least one item with an international name (INN) is required",
  "prescription.onlyActiveEditable": "Only an active prescription can be edited. Cancel it and issue a new one.",
  "prescription.alreadyDispensed": "The prescription has already been dispensed and cannot be edited. Cancel it and issue a new one.",
  "consent.duplicatePending": "A request to this patient is already pending. Wait for the answer or withdraw the previous request.",
  "consent.alreadyGranted": "The patient has already granted the clinic access to this data — no need to ask again.",
};
