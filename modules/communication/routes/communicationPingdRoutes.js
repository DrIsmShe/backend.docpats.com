import express from "express";
const router = express.Router();

// тестовый маршрут
router.get("/", (req, res) => {
  res.json({ success: true, message: "Communication module active" });
});

export default router;
