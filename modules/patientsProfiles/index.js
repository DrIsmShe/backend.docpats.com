import express from "express";
const router = express.Router();

import countAllDoctorForPatientRoute from "./routes/countAllDoctorForPatientRoute.js";
import countArticlesForPatientTodayRoute from "./routes/countAllArticlesForPatientRoute.js";
import countAllArticlesForPatientRoute from "./routes/countAllArticlesForPatientRoute.js";
import AllDoctorForPatientRoute from "./routes/AllDoctorForPatientRoute.js";
import AllDoctorArticlesForPatientRoute from "./routes/AllDoctorArticlesForPatientRoute.js";
import DoctorDetailsForPatientRoute from "./routes/DoctorDetailsForPatientRoute.js";
import articlesAllRoute from "./routes/articlesAllRoute.js";
import SearchPatientRoute from "./routes/SearchPatientRoute.js";
import getPatientUserProfileRote from "./routes/patientProfileRoute.js";
import addPatientPolyclinicRoute from "./routes/addPatientPolyclinicRoute.js";
import patientDetailsRoute from "./routes/patientDetailsRoute.js";
import notificationForConfirmationRoute from "./routes/notificationForConfirmationRoute.js";
import checkPatientInClinicRoute from "./routes/checkPatientInClinicRote.js";
import checkMyDoctorRoute from "./routes/checkMyDoctorRoute.js";

import profileUpdatePatientRoute from "./routes/profileUpdatePatientRoute.js";
import profileMainUpdatePatientRoute from "./routes/profileMainUpdatePatientRoute.js";
import changePasswordProfileOfPatientRoute from "./routes/changePasswordProfileOfPatientRoute.js";
import ArticleSingleRoute from "./routes/ArticleSingleRoute.js";
import addDoctorToMyDoctorsRoute from "./routes/addDoctorToMyDoctorsRoute.js";
import removeDoctorFromMyDoctorsRoute from "./routes/removeDoctorFromMyDoctorsRoute.js";
import getMyDoctorsRoute from "./routes/getMyDoctorsRoute.js";
import getMyMedicalHistoryRoute from "./routes/getMyMedicalHistoryRoute.js";
import getMyMedicalHistoryDetailsRoute from "./routes/getMyMedicalHistoryDetailsRoute.js";
import getMyMedicalFilesDetailsRoute from "./routes/getMyMedicalFilesDetailsRoute.js";
import UpdatePatientChangePhoneRoute from "./routes/UpdatePatientChangePhoneRoute.js";
import DoctorRecommendRoute from "./routes/patient-profile.js";
//exams details
import getMyLablFilesDetailsRoute from "./routes/getMyLablFilesDetailsRoute.js";
import getMyCTFilesDetailsRoute from "./routes/getMyCTlFilesDetailsRoute.js";
import getMyMRIFilesDetailsRoute from "./routes/getMyMRIFilesDetailsRoute.js";
import getMyUSMFilesDetailsRoute from "./routes/getMyUSMFilesDetailsRoute.js";
import getMyXRAYFilesDetailsRoute from "./routes/getMyXRAYFilesDetailsRoute.js";
import getMyPETSCANFilesDetailsRoute from "./routes/getMyPETSCANFilesDetailsRoute.js";
import getMySPECTScanFilesDetailsRoute from "./routes/getMySPECTScanFilesDetailsRoute.js";
import getMyEEGScanFilesDetailsRoute from "./routes/getMyEEGScanFilesDetailsRoute.js";
import getMyGinecologyFilesDetailsRoute from "./routes/getMyGinecologyFilesDetailsRoute.js";
import getMyHolterFilesDetailsRoute from "./routes/getMyHolterFilesDetailsRoute.js";
import getMySpirometryFilesDetailsRoute from "./routes/getMySpirometryFilesDetailsRoute.js";
import getMyDoplerFilesDetailsRoute from "./routes/getMyDoplerFilesDetailsRoute.js";
import getMyGastroscopyScanFilesDetailsRoute from "./routes/getMyGastroscopyScanFilesDetailsRoute.js";
import getMyCapsuleEndoscopyFilesDetailsRoute from "./routes/getMyCapsuleEndoscopyFilesDetailsRoute.js";
import getMyAngiographyScanFilesDetailsRoute from "./routes/getMyAngiographyScanFilesDetailsRoute.js";
import getMyEKGScanFilesDetailsRoute from "./routes/getMyEKGScanFilesDetailsRoute.js";
import getMyECHOEKGScanFilesDetailsRoute from "./routes/getMyECHOEKGScanFilesDetailsRoute.js";
import getMyCoronographyScanFilesDetailsRoute from "./routes/getMyCoronographyScanFilesDetailsRoute.js";

router.use("/get-my-medical-files", getMyMedicalFilesDetailsRoute);

//exams details start
router.use("/get-my-lab-file-details", getMyLablFilesDetailsRoute);
router.use("/get-my-ct-file-details", getMyCTFilesDetailsRoute);
router.use("/get-my-mri-file-details", getMyMRIFilesDetailsRoute);
router.use("/get-my-usm-file-details", getMyUSMFilesDetailsRoute);
router.use("/get-my-xray-file-details", getMyXRAYFilesDetailsRoute);
router.use("/get-my-pet-scan-file-details", getMyPETSCANFilesDetailsRoute);
router.use("/get-my-spect-scan-file-details", getMySPECTScanFilesDetailsRoute);
router.use("/get-my-eeg-scan-file-details", getMyEEGScanFilesDetailsRoute);
router.use("/get-my-ginekology-file-details", getMyGinecologyFilesDetailsRoute);
router.use("/get-my-holter-file-details", getMyHolterFilesDetailsRoute);
router.use("/get-my-spirometry-file-details", getMySpirometryFilesDetailsRoute);
router.use("/get-my-dopler-file-details", getMyDoplerFilesDetailsRoute);
router.use(
  "/get-my-gastroscopy-file-details",
  getMyGastroscopyScanFilesDetailsRoute
);
router.use(
  "/get-my-capsule-endoscopy-file-details",
  getMyCapsuleEndoscopyFilesDetailsRoute
);
router.use(
  "/get-my-angiography-file-details",
  getMyAngiographyScanFilesDetailsRoute
);
router.use("/get-my-ekg-file-details", getMyEKGScanFilesDetailsRoute);
router.use("/get-my-echo-ekg-file-details", getMyECHOEKGScanFilesDetailsRoute);
router.use(
  "/get-my-coronography-file-details",
  getMyCoronographyScanFilesDetailsRoute
);
//exams details end

router.use("/get-my-medical-history-details", getMyMedicalHistoryDetailsRoute);
router.use("/get-my-medical-history", getMyMedicalHistoryRoute);
router.use("/get-my-doctors", getMyDoctorsRoute);
router.use("/add-doctor", addDoctorToMyDoctorsRoute);
router.use("/remove-doctor", removeDoctorFromMyDoctorsRoute);
router.use("/check-my-doctor", checkMyDoctorRoute);
router.use("/profile-user-patient", getPatientUserProfileRote);
router.use("/check-patient-in-clinic", checkPatientInClinicRoute);
router.use("/api-patient", countAllDoctorForPatientRoute);
router.use("/api-patient", countArticlesForPatientTodayRoute);
router.use("/api-patient", countAllArticlesForPatientRoute);
router.use("/doctors-for-patient", AllDoctorForPatientRoute);
router.use("/doctor-details-for-patient", DoctorDetailsForPatientRoute);
router.use("/doctor-articles", AllDoctorArticlesForPatientRoute);
router.use("/articles-all", articlesAllRoute);
router.use("/article-single", ArticleSingleRoute);
router.use("/search-patient", SearchPatientRoute);
router.use("/add-patient-polyclinic", addPatientPolyclinicRoute);
router.use("/patient-details", patientDetailsRoute);
router.use("/notification-for-confirmation", notificationForConfirmationRoute);
router.use("/update-profile-of-patient", profileUpdatePatientRoute);
router.use("/update-main-profile-of-patient", profileMainUpdatePatientRoute);
router.use("/change-phone", UpdatePatientChangePhoneRoute);
router.use(
  "/change-password-in-profile-of-patient",
  changePasswordProfileOfPatientRoute
);
router.use("/doctor", DoctorRecommendRoute);

router.get("/patientprofilelayout", async (req, res) => {
  console.log("🔍 Проверяем сессию: ", req.session);
  console.log("🔍 ID пользователя:", req.session.userId);
  console.log("🔍 Роль пользователя:", req.session.role);

  if (!req.session.userId) {
    console.warn("⚠️ Пользователь не авторизован!");
    return res.status(401).json({
      authenticated: false,
      message: "Пользователь не авторизован",
    });
  }

  if (req.session.role !== "patient") {
    console.warn("⚠️ Доступ запрещен! Роль:", req.session.role);
    return res.status(403).json({
      authenticated: false,
      message: "Доступ разрешен только для пациентов",
    });
  }

  console.log("✅ Доступ разрешен");
  return res.status(200).json({
    authenticated: true,
    user: {
      role: req.session.role,
    },
  });
});

export default router;
