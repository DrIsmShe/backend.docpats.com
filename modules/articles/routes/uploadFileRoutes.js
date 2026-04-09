import { Router } from "express";
import {
  uploadPDF,
  getPDF,
} from "../../../common/middlewares/uploadPdfFileMiddleWere.js";

const router = Router();

router.post("/upload", uploadPDF);
router.get("/get-pdf/:fileName", getPDF);

export default router;
