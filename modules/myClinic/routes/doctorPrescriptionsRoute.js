import { Router } from "express";
import authMidleWeare from "../../../common/middlewares/authMiddleware.js";
import {
  требуетВерификации,
  ДЕЙСТВИЯ,
} from "../../../common/middlewares/requireVerifiedDoctor.js";
import {
  createDoctorPrescription,
  listDoctorPrescriptions,
  doctorPrescriptionPdf,
  updateDoctorPrescription,
} from "../controllers/doctorPrescriptionsController.js";

const router = Router();

/* Рецепт — на всех действиях, включая чтение и печать.
 *
 * В бланк уходит номер лицензии из карточки врача, а он свободный текст:
 * никто его не проверяет (см. clinic-medical/pdf/prescriptionPayload.js).
 * Пока документы не подтверждены, такой бланк не должен ни создаваться,
 * ни печататься, ни исправляться — распечатанный лист живёт своей жизнью
 * и обратно не отзывается.
 */
const нуженПодтверждённыйВрач = требуетВерификации(
  ДЕЙСТВИЯ.РЕЦЕПТЫ,
  "Выписка рецептов доступна после подтверждения документов врача.",
);

// resolvePatient здесь намеренно НЕ используется: он находит карту по
// идентификатору, но не проверяет, чья она. Для рецепта этого мало —
// владение проверяет сам контроллер.
router.get("/patient/:patientId", authMidleWeare, нуженПодтверждённыйВрач, listDoctorPrescriptions);
router.post("/patient/:patientId", authMidleWeare, нуженПодтверждённыйВрач, createDoctorPrescription);
router.get("/:id/pdf", authMidleWeare, нуженПодтверждённыйВрач, doctorPrescriptionPdf);
// Объявлен после /:id/pdf: иначе ":id" перехватил бы подпуть.
router.patch("/:id", authMidleWeare, нуженПодтверждённыйВрач, updateDoctorPrescription);

export default router;
