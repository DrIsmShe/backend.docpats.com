import { Router } from "express";
import AllDoctorArticlesController from "../controllers/AllDoctorArticlesController.js";
import AllDoctorController from "../controllers/AllDoctorController.js";
import articlesAllController from "../controllers/articlesAllController.js";
import {
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
} from "../controllers/categoryController.js";
import changePasswordProfileController from "../controllers/changePasswordProfileController.js";
import { body, query, validationResult } from "express-validator";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import addCommentDoctor from "../controllers/addCommentDoctorController.js";
import countAllArticlesController from "../controllers/countAllArticlesController.js";
import countAllDoctorController from "../controllers/countAllDoctorController.js";
import countArticlesTodayController from "../controllers/countArticlesTodayController.js";
import deleteMyArticleDoctorController from "../controllers/deleteMyArticleDoctorController.js";
import DoctorDetailController from "../controllers/DoctorDetailController.js";
import DoctorDetailsForPatientController from "../controllers/DoctorDetailsForPatientController.js";
import getMyArticlesDoctorController from "../controllers/getMyArticlesDoctorController.js";
import getProfileDoctorController from "../controllers/getProfileDoctorController.js";
import getSpecializationDetailDoctorController from "../controllers/getSpecializationDetailDoctorController.js";
import getSpecializationDoctorController from "../controllers/getSpecializationDoctorController.js";
import { getSingleArticle } from "../controllers/getSingleArticleController.js";
import ProfileControllerDoctor from "../controllers/profileDoctorController.js";
import profileMainUpdateDoctorController from "../controllers/profileMainUpdateDoctorController.js";
import profileUpdateDoctorController from "../controllers/profileUpdateDoctorController.js";
import {
  upload,
  resizeImage,
} from "../../../common/middlewares/uploadMiddleware.js";
import updateEmailController from "../controllers/updateEmailController.js";
import updateMyArticleController from "../controllers/updateMyArticleController.js";
import updatePhoneNumberDoctorController from "../controllers/updatePhoneNumberDoctorController.js";
import {
  uploadPDF,
  getPDF,
} from "../../../common/middlewares/uploadPdfFileMiddleWere.js";

const router = Router();

// === Маршруты докторов ===
router.get("/all-doctor-articles/:id", AllDoctorArticlesController);
router.get("/all-doctors", AllDoctorController);
router.get("/articles-all", articlesAllController);

// === Категории ===
router.post("/category", createCategory);
router.get("/categories", getAllCategories);
router.get("/category/:id", getCategoryById);
router.put("/category/:id", updateCategory);
router.delete("/category/:id", deleteCategory);

// === Пароль ===
router.post("/change-password", changePasswordProfileController);

// === Комментарии ===
const validateCommentCreation = [
  body("content").notEmpty().withMessage("Контент обязателен"),
  body("author").notEmpty().isMongoId().withMessage("Неверный ID автора"),
  body("article").notEmpty().isMongoId().withMessage("Неверный ID статьи"),
  body("parentComment").optional().isMongoId(),
];

const validatePagination = [
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Неверный номер страницы"),
  query("limit").optional().isInt({ min: 1 }).withMessage("Неверный лимит"),
];

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.post(
  "/comment/:id",
  authMiddleware,
  validateCommentCreation,
  handleValidationErrors,
  addCommentDoctor
);

// === Статистика ===
router.get("/count-articles-all", countAllArticlesController);
router.get("/count-doctors-all", countAllDoctorController);
router.get("/count-articles-today", countArticlesTodayController);

// === Статьи ===
router.delete("/article/:id", deleteMyArticleDoctorController);
router.get("/article/:id", getSingleArticle);
router.put(
  "/article/:id",
  authMiddleware,
  upload.single("image"),
  resizeImage,
  updateMyArticleController
);
router.get("/my-articles", getMyArticlesDoctorController);

// === Профиль доктора ===
router.get("/doctor/:id", DoctorDetailController);
router.get("/doctor-details/:id", DoctorDetailsForPatientController);
router.get("/profile/:userId", authMiddleware, getProfileDoctorController);
router.get("/specialization/:id", getSpecializationDetailDoctorController);
router.get("/specializations", getSpecializationDoctorController);
router.post("/profile", authMiddleware, ProfileControllerDoctor);
router.post("/profile/update", profileMainUpdateDoctorController);
router.post(
  "/profile/update-photo",
  upload.single("image"),
  resizeImage,
  profileUpdateDoctorController
);
router.put("/profile/email", updateEmailController);
router.put("/profile/phone", updatePhoneNumberDoctorController);

// === Файлы ===
router.post("/upload", uploadPDF);
router.get("/get-pdf/:fileName", getPDF);

export default router;
