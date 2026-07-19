import express from "express";
const router = express.Router();

// DOCTOR PROFILE ROUTES START
import EndorseRecomendationDoctorFromDoctorRoute from "./endorseRecomendationDoctorFromDoctorRoute.js";
import friendsDoctorRoute from "./friendsDoctorRoute.js";
import AllDoctorRoute from "./AllDoctorRoute.js";
import DoctorDetailRoute from "./DoctorDetailRoute.js";
import changePasswordProfileRoute from "./changePasswordProfileRoute.js";
import profileDoctorRoute from "./profileDoctorRoute.js";
import profileUpdateDoctorRoute from "./profileUpdateDoctorRoute.js";
import profileMainUpdateDoctorRoute from "./profileMainUpdateDoctorRoute.js";
import updatePhoneNumberDoctorRoute from "./updatePhoneNumberDoctorRoute.js";
import updateEmailDoctorRoute from "./updateEmailDoctorRoute.js";
import getSpecializationDoctorRoute from "./getSpecializationDoctorRoute.js";
import getSpecializationDetailDoctorRoute from "./getSpecializationDetailDoctorRoute.js";
import getProfileDoctorRoute from "./getProfileDoctorRoute.js";

router.use(
  "/recommendations-from-doctor",
  EndorseRecomendationDoctorFromDoctorRoute,
);
router.use("/api-follows", friendsDoctorRoute);
router.use("/doctors", AllDoctorRoute);
router.use("/doctor-detail", DoctorDetailRoute);
router.use("/change-password-in-profile", changePasswordProfileRoute);
router.use("/create-profile", profileDoctorRoute);
router.use("/update-profile-of-doctor", profileUpdateDoctorRoute);
router.use("/update-main-profile-of-doctor", profileMainUpdateDoctorRoute);
router.use("/update-phonenumber", updatePhoneNumberDoctorRoute);
router.use("/update-email-doctor", updateEmailDoctorRoute);
router.use("/get-specialization", getSpecializationDoctorRoute);
router.use("/get-doctor-specialization", getSpecializationDetailDoctorRoute);
router.use("/get-profile-doctor", getProfileDoctorRoute);
// DOCTOR PROFILE ROUTES END

// COUNT OF ARTICLES OF DOCTOR START
import countAllDoctorRoute from "./countAllDoctorRoute.js";
import countArticlesTodayRoute from "./countArticlesTodayRoute.js";
import countAllArticlesRoute from "./countAllArticlesRoute.js";
import countPatientsRoute from "./countPatientsRoute.js";

router.use("/api", countAllDoctorRoute);
router.use("/api", countArticlesTodayRoute);
router.use("/api", countAllArticlesRoute);
router.use("/api", countPatientsRoute);
// COUNT OF ARTICLES OF DOCTOR END

// COUNT OF SCIENTIFIC ARTICLES OF DOCTOR START
import countSCIENTIFICArticlesTodayRoute from "./countSCIENTIFICArticlesTodayRoute.js";
import countSCIENTIFICAllArticlesRoute from "./countSCIENTIFICAllArticlesRoute.js";

router.use("/api", countSCIENTIFICArticlesTodayRoute);
router.use("/api", countSCIENTIFICAllArticlesRoute);
// COUNT OF SCIENTIFIC ARTICLES OF DOCTOR END

// ARTICLES OF DOCTOR START

import articlesAllRoute from "./articlesAllRoute.js";
import AllDoctorArticlesRoute from "./AllDoctorArticlesRoute.js";
import myArticlesDoctorRoute from "./getMyArticlesDoctorRoute.js";
import myArticleSingleRoute from "./myArticleSingleRoute.js";
import createArticleRoute from "./createArticleRoute.js";
import deleteMyArticleDoctor from "./deleteMyArtcleDoctorRoute.js";
import updateMyarticleRoute from "./updateMyarticleRoute.js";

router.use("/articles-all", articlesAllRoute);
router.use("/doctor-articles", AllDoctorArticlesRoute);
router.use("/my-articles", myArticlesDoctorRoute);
router.use("/my-article-single", myArticleSingleRoute);
router.use("/create-my-article", createArticleRoute);
router.use("/delete-my-article", deleteMyArticleDoctor);
router.use("/update-my-article", updateMyarticleRoute);
// ARTICLES OF DOCTOR END

// SCIENTIFIC ARTICLES OF DOCTOR START
import articlesScientificAllRoute from "./articlesScientificAllRoute.js";
import AllDoctorArticleScientificsRoute from "./AllDoctorArticleScientificsRoute.js";
import myArticleScientificDoctorRoute from "./myArticleScientificDoctorRoute.js";
import myArticleScientificSingleRoute from "./myArticleScientificSingleRoute.js";
import createArticleScientificRoute from "./createArticleScientificRoute.js";
import deleteMyArticleScientificDoctor from "./deleteMyArticleScientificDoctor.js";
import updateMyarticleScientificRoute from "./updateMyarticleScientificRoute.js";

router.use("/articles-scientific-all", articlesScientificAllRoute);
router.use("/doctor-articles-scientific", AllDoctorArticleScientificsRoute);
router.use("/my-articles-scientific", myArticleScientificDoctorRoute);
router.use("/my-article-scientific-single", myArticleScientificSingleRoute);
router.use("/create-my-article-scientific", createArticleScientificRoute);
router.use("/delete-my-article-scientific", deleteMyArticleScientificDoctor);
router.use("/update-my-article-scientific", updateMyarticleScientificRoute);
// SCIENTIFIC ARTICLES OF DOCTOR END

// DOCTOR VERIFICATIONS ROUTES START
import addVerificationDocumentsRoute from "./addVerificationDocumentsRoute.js";
import getVerificationDocumentsRoute from "./getVerificationDocumentsRoute.js";
import CancelVerificationDocumentsRoute from "./CancelVerificationDocumentsRoute.js";

router.use("/add-verification", addVerificationDocumentsRoute);
router.use("/get-verification", getVerificationDocumentsRoute);
router.use("/cancel-verification-document", CancelVerificationDocumentsRoute);

// Отзывы пациентов о враче (публичное чтение + авторизованная отправка)
import doctorReviewRoute from "./doctorReviewRoute.js";
router.use("/reviews", doctorReviewRoute);
// Публичный «счётчик доверия» на профиле врача (агрегаты, без PHI).
import { getDoctorTrustStats } from "../controllers/doctorReview.controller.js";
router.get("/stats/:doctorProfileId", getDoctorTrustStats);
// DOCTOR VERIFICATIONS ROUTES END

// Проверка авторизации врача
router.get("/doctorprofilelayout", async (req, res) => {
  console.log("🔍 Checking doctor session: ", req.session);
  console.log("🔍 User ID:", req.session.userId);
  console.log("🔍 User role:", req.session.role);

  if (!req.session.userId) {
    console.warn("⚠️ User is not authorized!");
    return res.status(401).json({
      authenticated: false,
      message: "User is not authorized",
    });
  }

  if (req.session.role !== "doctor") {
    console.warn("⚠️ Access denied! Role:", req.session.role);
    return res.status(403).json({
      authenticated: false,
      message: "Access allowed only for doctors",
    });
  }

  console.log("✅ Access allowed for doctor");
  return res.status(200).json({
    authenticated: true,
    user: {
      role: req.session.role,
    },
  });
});

export default router;
