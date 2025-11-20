import { Router } from "express";
import { registerUser } from "../controllers/regController.js";
import specialization from "../controllers/specialization.js";
import validateRegistration from "../../../common/middlewares/authvalidateMiddleware/registerValidate.js";
const router = Router();

router.post("/", validateRegistration, registerUser);
router.get("/get-specialization", specialization);

export default router;
