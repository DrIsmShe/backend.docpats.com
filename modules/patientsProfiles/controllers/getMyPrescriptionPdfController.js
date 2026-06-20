// server/modules/patientsProfiles/controllers/getMyPrescriptionPdfController.js
//
// PDF одного рецепта для пациента. Тот же генератор, что у клиники
// (buildPrescriptionPdf), но владение проверяется через linkedUserId
// карты пациента, а НЕ через RBAC клиники.
//
// GET /patient-profile/get-my-prescription-pdf/:id?lang=ru
// Ответ: application/pdf (inline) либо JSON-ошибка.

import mongoose from "mongoose";
import Prescription from "../../../common/models/Polyclinic/Prescription.js";
import ClinicPatient, {
  decryptValue,
} from "../../clinic/clinic-patients/models/clinicPatient.model.js";
import Clinic from "../../clinic/clinic-core/models/clinic.model.js";

const getMyPrescriptionPdfController = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "Неверный формат ID" });
    }

    const userId = req.user?.userId || req.session?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: "Не авторизован" });
    }

    // 1. Рецепт.
    const rx = await Prescription.findById(id).lean();
    if (!rx || !rx.patientRef) {
      return res.status(404).json({ ok: false, error: "Рецепт не найден" });
    }

    // 2. Владение: карта рецепта привязана к этому пользователю.
    const card = await ClinicPatient.findById(rx.patientRef)
      .setOptions({ skipTenantScope: true })
      .select(
        "_id linkedUserId firstNameEncrypted lastNameEncrypted dateOfBirth",
      )
      .lean();

    if (!card || String(card.linkedUserId || "") !== String(userId)) {
      return res.status(403).json({ ok: false, error: "Доступ запрещён" });
    }

    // 3. Клиника-автор (для шапки бланка).
    const clinic = rx.createdByClinicId
      ? await Clinic.findById(rx.createdByClinicId).lean()
      : null;

    // 4. Та же форма данных, что отдаёт clinic-сервис в toApiShape.
    const prescription = {
      _id: String(rx._id),
      status: rx.status,
      issuedAt: rx.issuedAt || rx.createdAt || null,
      createdAt: rx.createdAt || null,
      diagnosis: rx.diagnosis
        ? {
            code: rx.diagnosis.code || "",
            codeTitle: rx.diagnosis.codeTitle || "",
            text: rx.diagnosis.text || "",
          }
        : null,
      generalNotes: rx.generalNotes || "",
      items: Array.isArray(rx.items) ? rx.items : [],
    };

    const patient = {
      firstName: decryptValue(card.firstNameEncrypted) || "",
      lastName: decryptValue(card.lastNameEncrypted) || "",
      dateOfBirth: card.dateOfBirth || null,
    };

    // 5. Тот же генератор, что у клиники.
    const { buildPrescriptionPdf } =
      await import("../../clinic/clinic-medical/pdf/prescriptionPdf.js");

    const pdfBuffer = await buildPrescriptionPdf({
      prescription,
      clinic,
      patient,
      lang: req.query?.lang || clinic?.defaultLanguage || "ru",
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="prescription-${prescription._id}.pdf"`,
    );
    return res.status(200).send(pdfBuffer);
  } catch (error) {
    console.error("❌ getMyPrescriptionPdf error:", error);
    return next ? next(error) : res.status(500).json({ ok: false });
  }
};

export default getMyPrescriptionPdfController;
