import { Router } from "express";
import { upload, uploadFile, getPDF } from "../middlewares/uploadMiddleware.js";
import adminRoute from "../../modules/admin/routes/adminRoute.js";
const router = Router();

router.post("/upload", upload.single("pdf"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "PDF not found" });

  try {
    const url = await uploadFile(req.file);
    res.status(201).json({ uploaded: true, url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/get-pdf/:fileName", getPDF);
router.use("/admin", adminRoute);
export default router;
