import express from "express";
const router = express.Router();

// system POLYCLINIC start

import patientsMedicalHistoryGetDetailsRoute from "./routes/patientsMedicalHistoryGetDetailsRoute.js";
import patientsMedicalHistoryGetRoute from "./routes/patientsMedicalHistoryGetRoute.js";
import addPatientPolyclinicRoute from "./routes/addPatientPolyclinicRoute.js";
import patientDetailsRoute from "./routes/patientDetailsRoute.js";
import patientsPolyclinicRoute from "./routes/patientsPolyclinicRoute.js";
import addPatientsPolyclinicMedicalHistoryRoute from "./routes/addPatientsPolyclinicMedicalHistoryRoute.js";
import patientSearchPolyclinicRoute from "./routes/patientSearchPolyclinicRoute.js";
import patientDeleteFromDoctorRoute from "./routes/patientDeleteFromDoctorRoute.js";
// Подключаем маршруты для шаблонов жалоб (complaints)
import tempComplaintsListGetRoute from "./routes/tempComplaintsListGetRoute.js";
import tempComplaintsDetailGetRoute from "./routes/tempComplaintsDetailGetRoute.js";
import tempComplaintsRoute from "./routes/tempComplaintsRoute.js";
import tempComplaintDeleteRoute from "./routes/tempComplaintDeleteRoute.js";
// Подключаем маршруты для анамнеза morbi
import tempAnamnesisMorbiRoute from "./routes/tempAnamnesisMorbiRoute.js";
import tempAnamnesisMorbiListGetRoute from "./routes/tempAnamnesisMorbiListGetRoute.js";
import tempAnamnesisMorbiDetailGetRoute from "./routes/tempAnamnesisMorbiDetailGetRoute.js";
import tempAnamnesisMorbitDeleteRoute from "./routes/tempAnamnesisMorbitDeleteRoute.js";

// Подключаем маршруты для анамнеза vitae
import tempAnamnesisVitaeRoute from "./routes/tempAnamnesisVitaeRoute.js";
import tempAnamnesisVitaeListGetRoute from "./routes/tempAnamnesisVitaeListGetRoute.js";
import tempAnamnesisVitaeDetailGetRoute from "./routes/tempAnamnesisVitaeDetailGetRoute.js";
import tempAnamnesisVitaetDeleteRoute from "./routes/tempAnamnesisVitaetDeleteRoute.js";

// Подключаем маршруты для результатов КТ
import tempCTScanResultsRoute from "./routes/tempCTScanResultsRoute.js";
import tempCTScanResultsListGetRoute from "./routes/tempCTScanResultsListGetRoute.js";
import tempCTScanResultsDetailGetRoute from "./routes/tempCTScanResultsDetailGetRoute.js";
import tempCTScanResultsDeleteRoute from "./routes/tempCTScanResultsDeleteRoute.js";

// Подключаем маршруты для лабораторных тестов
import tempLaboratoryTestResultsRoute from "./routes/tempLaboratoryTestResultsRoute.js";
import tempLaboratoryTestResultsListGetRoute from "./routes/tempLaboratoryTestResultsListGetRoute.js";
import tempLaboratoryTestResultsDetailGetRoute from "./routes/tempLaboratoryTestResultsDetailGetRoute.js";
import tempLaboratoryTestResultsDeleteRoute from "./routes/tempLaboratoryTestResultsDeleteRoute.js";

// Подключаем маршруты для результатов МРТ
import tempMRIResultsRoute from "./routes/tempMRIResultsRoute.js";
import tempMRIResultsListGetRoute from "./routes/tempMRIResultsListGetRoute.js";
import tempMRIResultsDetailGetRoute from "./routes/tempMRIResultsDetailGetRoute.js";
import tempMRIResultsDeleteRoute from "./routes/tempMRIResultsDeleteRoute.js";

// Подключаем маршруты для рекомендаций
import tempRecommendationsRoute from "./routes/tempRecommendationsRoute.js";
import tempRecommendationsListGetRoute from "./routes/tempRecommendationsListGetRoute.js";
import tempRecommendationsDetailGetRoute from "./routes/tempRecommendationsDetailGetRoute.js";
import tempRecommendationsDeleteGetRoute from "./routes/tempRecommendationsDeleteGetRoute.js";

// Подключаем маршруты для статуса локализации
import tempStatusLocalisRoute from "./routes/tempStatusLocalisRoute.js";
import tempStatusLocalisListGetRoute from "./routes/tempStatusLocalisListGetRoute.js";
import tempStatusLocalisDetailGetRoute from "./routes/tempStatusLocalisDetailGetRoute.js";
import tempStatusLocalisDeleteRoute from "./routes/tempStatusLocalisDeleteRoute.js";
// Подключаем маршруты для статуса презенции
import tempStatusPreasensRoute from "./routes/tempStatusPreasensRoute.js";
import tempStatusPreasensListGetRoute from "./routes/tempStatusPreasensListGetRoute.js";
import tempStatusPreasensDetailGetRoute from "./routes/tempStatusPreasensDetailGetRoute.js";
import tempStatusPreasensDeleteRoute from "./routes/tempStatusPreasensDeleteRoute.js";

// Подключаем маршруты для ультразвуковых результатов
import tempUltrasoundResultsRoute from "./routes/tempUltrasoundResultsRoute.js";
import tempUltrasoundResultsListGetRoute from "./routes/tempUltrasoundResultsListGetRoute.js";
import tempUltrasoundResultsDetailGetRoute from "./routes/tempUltrasoundResultsDetailGetRoute.js";
import tempUltrasoundDeleteRoute from "./routes/tempUltrasoundDeleteRoute.js";
import addPrivatePatientPolyclinicRoute from "./routes/addPrivatePatientPolyclinicRoute.js";

// system POLYCLINIC end
// system POLYCLINIC start
router.use("/search-patients-polyclinic", patientSearchPolyclinicRoute);
router.use("/add-private-patient-polyclinic", addPrivatePatientPolyclinicRoute);
router.use("/add-patient-polyclinic", addPatientPolyclinicRoute);
router.use("/patient-details", patientDetailsRoute);
router.use("/patients-polyclinic", patientsPolyclinicRoute);

router.use("/patient-delete-from-offices-doctor", patientDeleteFromDoctorRoute);

// Для анамнеза medical-history
router.use(
  "/patients-polyclinic-medical-history",
  addPatientsPolyclinicMedicalHistoryRoute,
);
router.use("/patients-medical-history-get", patientsMedicalHistoryGetRoute);
router.use(
  "/patients-medical-history-get-details",
  patientsMedicalHistoryGetDetailsRoute,
);

// EXAMINATIONS START
import addExaminationsRoutes from "./routes/ExaminationRoutes/addExaminationsRoutes.js";
router.use("/add-examinations", addExaminationsRoutes);

import getExaminationsRoutes from "./routes/ExaminationRoutes/getExaminationsRoutes.js";
router.use("/get-examinations", getExaminationsRoutes);

import getDetailExaminationsRoutes from "./routes/ExaminationRoutes/getDetailExaminationsRoutes.js";
router.use("/get-detail-examinations", getDetailExaminationsRoutes);

//EXAMINATIONS END

//Templates Examinations Start

import addTemplatesExaminationsRoutes from "./routes/ExaminationRoutes/ExamenationsTemplates/addTemplatesExaminationsRoutes.js";
router.use("/add-templates-examinations", addTemplatesExaminationsRoutes);

import getTemplatesExaminationsRoutes from "./routes/ExaminationRoutes/ExamenationsTemplates/getTemplatesExaminationsRoutes.js";
router.use("/get-templates-examinations", getTemplatesExaminationsRoutes);

import deleteTemplatesExaminationsRoutes from "./routes/ExaminationRoutes/ExamenationsTemplates/deleteTemplatesExaminationsRoutes.js";
router.use("/delete-templates-examinations", deleteTemplatesExaminationsRoutes);

import updateTemplatesExaminationsRoutes from "./routes/updateTemplatesExaminationsRoutes.js";
router.use("/update-templates-examinations", updateTemplatesExaminationsRoutes);

import detailsTemplatesExaminationsRoutes from "./routes/ExaminationRoutes/ExamenationsTemplates/detailsTemplatesExaminationsRoutes.js";
router.use(
  "/details-templates-examinations",
  detailsTemplatesExaminationsRoutes,
);
//Templates Examinations END

// Для  complaints
router.use("/temp-complaints", tempComplaintsRoute);
router.use("/temp-complaints-list", tempComplaintsListGetRoute);
router.use("/temp-complaints-detail", tempComplaintsDetailGetRoute);
router.use("/temp-complaint-delete", tempComplaintDeleteRoute);

// Подключаем маршруты для шаблонов жалоб (complaints)
import tempAdditionalDiagnosisRoute from "./routes/TempMedicalHistory/tempAdditionalDiagnosisRoute.js";
import tempAdditionalDiagnosisListGetRoute from "./routes/TempMedicalHistory/tempAdditionalDiagnosisListGetRoute.js";
import tempAdditionalDiagnosisDetailGetRoute from "./routes/TempMedicalHistory/tempAdditionalDiagnosisDetailGetRoute.js";
import tempAdditionalDiagnosisDeleteRoute from "./routes/TempMedicalHistory/tempAdditionalDiagnosisDeleteRoute.js";
// Для AdditionalDiagnosis
router.use("/temp-additionalDiagnosis", tempAdditionalDiagnosisRoute);
router.use(
  "/temp-additionalDiagnosis-list",
  tempAdditionalDiagnosisListGetRoute,
);
router.use(
  "/temp-additionalDiagnosis-detail",
  tempAdditionalDiagnosisDetailGetRoute,
);
router.use(
  "/temp-additionalDiagnosis-delete",
  tempAdditionalDiagnosisDeleteRoute,
);

// Для анамнеза morbi
router.use("/temp-anamnesis-morbi", tempAnamnesisMorbiRoute);
router.use("/temp-anamnesis-morbi-list", tempAnamnesisMorbiListGetRoute);
router.use("/temp-anamnesis-morbi-detail", tempAnamnesisMorbiDetailGetRoute);
router.use("/temp-anamnesis-morbi-delete", tempAnamnesisMorbitDeleteRoute);

// Для анамнеза vitae
router.use("/temp-anamnesis-vitae", tempAnamnesisVitaeRoute);
router.use("/temp-anamnesis-vitae-list", tempAnamnesisVitaeListGetRoute);
router.use("/temp-anamnesis-vitae-detail", tempAnamnesisVitaeDetailGetRoute);
router.use("/temp-anamnesis-vitae-delete", tempAnamnesisVitaetDeleteRoute);

// Для результатов КТ
router.use("/temp-ct-scan", tempCTScanResultsRoute);
router.use("/temp-ct-scan-list", tempCTScanResultsListGetRoute);
router.use("/temp-ct-scan-detail", tempCTScanResultsDetailGetRoute);
router.use("/temp-ct-scan-delete", tempCTScanResultsDeleteRoute);

// Для лабораторных тестов
router.use("/temp-laboratory-tests", tempLaboratoryTestResultsRoute);
router.use(
  "/temp-laboratory-tests-list",
  tempLaboratoryTestResultsListGetRoute,
);
router.use(
  "/temp-laboratory-tests-detail",
  tempLaboratoryTestResultsDetailGetRoute,
);
router.use(
  "/temp-laboratory-tests-delete",
  tempLaboratoryTestResultsDeleteRoute,
);

// Для результатов МРТ
router.use("/temp-mri-results", tempMRIResultsRoute);
router.use("/temp-mri-results-list", tempMRIResultsListGetRoute);
router.use("/temp-mri-results-detail", tempMRIResultsDetailGetRoute);
router.use("/temp-mri-results-delete", tempMRIResultsDeleteRoute);

// Для рекомендаций
router.use("/temp-recommendations", tempRecommendationsRoute);
router.use("/temp-recommendations-list", tempRecommendationsListGetRoute);
router.use("/temp-recommendations-detail", tempRecommendationsDetailGetRoute);
router.use("/temp-recommendations-delete", tempRecommendationsDeleteGetRoute);

// Для статуса локализации
router.use("/temp-status-localis", tempStatusLocalisRoute);
router.use("/temp-status-localis-list", tempStatusLocalisListGetRoute);
router.use("/temp-status-localis-detail", tempStatusLocalisDetailGetRoute);
router.use("/temp-status-localis-delete", tempStatusLocalisDeleteRoute);
// Для статуса презенции
router.use("/temp-status-preasens", tempStatusPreasensRoute);
router.use("/temp-status-preasens-list", tempStatusPreasensListGetRoute);
router.use("/temp-status-preasens-detail", tempStatusPreasensDetailGetRoute);
router.use("/temp-status-preasens-delete", tempStatusPreasensDeleteRoute);

// Для ультразвуковых результатов
router.use("/temp-ultrasound-results", tempUltrasoundResultsRoute);
router.use("/temp-ultrasound-results-list", tempUltrasoundResultsListGetRoute);
router.use(
  "/temp-ultrasound-results-detail",
  tempUltrasoundResultsDetailGetRoute,
);
router.use("/temp-ultrasound-preasens-delete", tempUltrasoundDeleteRoute);

// system POLYCLINIC end
export default router;
