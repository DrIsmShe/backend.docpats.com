// server/common/utils/buildPatientQuery.js

const buildPatientQuery = (patient, patientType) => {
  if (!patient || !patientType) return {};

  if (patientType === "registered") {
    return { patient: patient._id };
  }

  if (patientType === "private") {
    return { patientId: String(patient._id) }; // 🔥 ВАЖНО
  }

  return {};
};

export default buildPatientQuery;
