import express from "express";
const router = express.Router();

// DOCTOR PROFILE ROUTES START
import EndorseRecomendationDoctorFromDoctorRoute from "./routes/endorseRecomendationDoctorFromDoctorRoute.js";
import friendsDoctorRoute from "./routes/friendsDoctorRoute.js";
import AllDoctorRoute from "./routes/AllDoctorRoute.js";
import DoctorDetailRoute from "./routes/DoctorDetailRoute.js";
import changePasswordProfileRoute from "./routes/changePasswordProfileRoute.js";
import profileDoctorRoute from "./routes/profileDoctorRoute.js";
import profileUpdateDoctorRoute from "./routes/profileUpdateDoctorRoute.js";
import profileMainUpdateDoctorRoute from "./routes/profileMainUpdateDoctorRoute.js";
import updatePhoneNumberDoctorRoute from "./routes/updatePhoneNumberDoctorRoute.js";
import updateEmailDoctorRoute from "./routes/updateEmailDoctorRoute.js";
import getSpecializationDoctorRoute from "./routes/getSpecializationDoctorRoute.js";
import getSpecializationDetailDoctorRoute from "./routes/getSpecializationDetailDoctorRoute.js";
import getProfileDoctorRoute from "./routes/getProfileDoctorRoute.js";

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
import countAllDoctorRoute from "./routes/countAllDoctorRoute.js";
import countArticlesTodayRoute from "./routes/countArticlesTodayRoute.js";
import countAllArticlesRoute from "./routes/countAllArticlesRoute.js";
import countPatientsRoute from "./routes/countPatientsRoute.js";

router.use("/api", countAllDoctorRoute);
router.use("/api", countArticlesTodayRoute);
router.use("/api", countAllArticlesRoute);
router.use("/api", countPatientsRoute);
// COUNT OF ARTICLES OF DOCTOR END

// ARTICLES OF DOCTOR START

import articlesAllRoute from "./routes/articlesAllRoute.js";
import AllDoctorArticlesRoute from "./routes/AllDoctorArticlesRoute.js";
import myArticlesDoctorRoute from "./routes/getMyArticlesDoctorRoute.js";
import myArticleSingleRoute from "./routes/myArticleSingleRoute.js";
import createArticleRoute from "./routes/createArticleRoute.js";
import deleteMyArticleDoctor from "./routes/deleteMyArtcleDoctorRoute.js";
import updateMyarticleRoute from "./routes/updateMyarticleRoute.js";

router.use("/articles-all", articlesAllRoute);
router.use("/doctor-articles", AllDoctorArticlesRoute);
router.use("/my-articles", myArticlesDoctorRoute);
router.use("/my-article-single", myArticleSingleRoute);
router.use("/create-my-article", createArticleRoute);
router.use("/delete-my-article", deleteMyArticleDoctor);
router.use("/update-my-article", updateMyarticleRoute);
// ARTICLES OF DOCTOR END

// SCIENTIFIC ARTICLES OF DOCTOR START
import articlesScientificAllRoute from "./routes/articlesScientificAllRoute.js";
import AllDoctorArticleScientificsRoute from "./routes/AllDoctorArticleScientificsRoute.js";
import myArticleScientificDoctorRoute from "./routes/myArticleScientificDoctorRoute.js";
import myArticleScientificSingleRoute from "./routes/myArticleScientificSingleRoute.js";
import createArticleScientificRoute from "./routes/createArticleScientificRoute.js";
import deleteMyArticleScientificDoctor from "./routes/deleteMyArticleScientificDoctor.js";
import updateMyarticleScientificRoute from "./routes/updateMyarticleScientificRoute.js";

router.use("/articles-scientific-all", articlesScientificAllRoute);
router.use("/doctor-articles-scientific", AllDoctorArticleScientificsRoute);
router.use("/my-articles-scientific", myArticleScientificDoctorRoute);
router.use("/my-article-scientific-single", myArticleScientificSingleRoute);
router.use("/create-my-article-scientific", createArticleScientificRoute);
router.use("/delete-my-article-scientific", deleteMyArticleScientificDoctor);
router.use("/update-my-article-scientific", updateMyarticleScientificRoute);
// SCIENTIFIC ARTICLES OF DOCTOR END

// DOCTOR VERIFICATIONS ROUTES START
import addVerificationDocumentsRoute from "./routes/addVerificationDocumentsRoute.js";
import getVerificationDocumentsRoute from "./routes/getVerificationDocumentsRoute.js";
import CancelVerificationDocumentsRoute from "./routes/CancelVerificationDocumentsRoute.js";

router.use("/add-verification", addVerificationDocumentsRoute);
router.use("/get-verification", getVerificationDocumentsRoute);
router.use("/cancel-verification-document", CancelVerificationDocumentsRoute);
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
