import express from "express";
const router = express.Router();
// DOCTOR PROFILE ROUTES

import profileDoctorRoute from "./routes/profileDoctorRoute.js";
import getProfileDoctorRoute from "./routes/getProfileDoctorRoute.js";
import profileUpdateDoctorRoute from "./routes/profileUpdateDoctorRoute.js";
import profileMainUpdateDoctorRoute from "./routes/profileMainUpdateDoctorRoute.js";
import myArticlesDoctorRoute from "./routes/getMyArticlesDoctorRoute.js";
import myArticleSingleRoute from "./routes/myArticleSingleRoute.js";
import updateMyarticleRoute from "./routes/updateMyarticleRoute.js";
import deleteMyArticleDoctor from "./routes/deleteMyArtcleDoctorRoute.js";
import updatePhoneNumberDoctorRoute from "./routes/updatePhoneNumberDoctorRoute.js";
import updateEmailDoctorRoute from "./routes/updateEmailDoctorRoute.js";
import getSpecializationDoctorRoute from "./routes/getSpecializationDoctorRoute.js";
import getSpecializationDetailDoctorRoute from "./routes/getSpecializationDetailDoctorRoute.js";

// SHARED ROUTES FOR DOCTOR PROFILE
import countAllDoctorRoute from "./routes/countAllDoctorRoute.js";
import countArticlesTodayRoute from "./routes/countArticlesTodayRoute.js";
import countAllArticlesRoute from "./routes/countAllArticlesRoute.js";
import AllDoctorRoute from "./routes/AllDoctorRoute.js";
import AllDoctorArticlesRoute from "./routes/AllDoctorArticlesRoute.js";
import DoctorDetailRoute from "./routes/DoctorDetailRoute.js";
import changePasswordProfileRoute from "./routes/changePasswordProfileRoute.js";
import createArticleRoute from "./routes/createArticleRoute.js";
import articlesAllRoute from "./routes/articlesAllRoute.js";
import friendsDoctorRoute from "./routes/friendsDoctorRoute.js";

// SHARED ROUTES

import EndorseRecomendationDoctorFromDoctorRoute from "./routes/endorseRecomendationDoctorFromDoctorRoute.js";

router.use(
  "/recommendations-from-doctor",
  EndorseRecomendationDoctorFromDoctorRoute
);

router.use("/api-follows", friendsDoctorRoute);
router.use("/api", countAllDoctorRoute);
router.use("/api", countArticlesTodayRoute);
router.use("/api", countAllArticlesRoute);
router.use("/doctors", AllDoctorRoute);
router.use("/doctor-articles", AllDoctorArticlesRoute);
router.use("/doctor-detail", DoctorDetailRoute);
router.use("/articles-all", articlesAllRoute);
// DOCTOR PROFILE ROUTES
router.use("/change-password-in-profile", changePasswordProfileRoute);
router.use("/my-articles", myArticlesDoctorRoute);
router.use("/my-article-single", myArticleSingleRoute);
router.use("/create-profile", profileDoctorRoute);
router.use("/create-my-article", createArticleRoute);
router.use("/update-profile-of-doctor", profileUpdateDoctorRoute);
router.use("/update-main-profile-of-doctor", profileMainUpdateDoctorRoute);
router.use("/delete-my-article", deleteMyArticleDoctor);
router.use("/update-my-article", updateMyarticleRoute);
router.use("/update-phonenumber", updatePhoneNumberDoctorRoute);
router.use("/update-email-doctor", updateEmailDoctorRoute);
router.use("/get-specialization", getSpecializationDoctorRoute);
router.use("/get-doctor-specialization", getSpecializationDetailDoctorRoute);
router.use("/get-profile-doctor", getProfileDoctorRoute);

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
