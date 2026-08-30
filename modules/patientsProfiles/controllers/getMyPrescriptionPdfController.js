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
import ClinicPatient from "../../clinic/clinic-patients/models/clinicPatient.model.js";
import Clinic from "../../clinic/clinic-core/models/clinic.model.js";
import {
  buildPatientForPdf,
  decryptPrescriptionDoc,
  resolvePrescriber,
} from "../../clinic/clinic-medical/pdf/prescriptionPayload.js";

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
        "_id linkedUserId firstNameEncrypted lastNameEncrypted dateOfBirth " +
          "gender weightKg phoneEncrypted",
      );

    if (!card || String(card.linkedUserId || "") !== String(userId)) {
      return res.status(403).json({ ok: false, error: "Доступ запрещён" });
    }

    // 3. Клиника-автор (для шапки бланка).
    const clinic = rx.createdByClinicId
      ? await Clinic.findById(rx.createdByClinicId).lean()
      : null;

    // 4. Та же форма данных, что отдаёт clinic-сервис в toApiShape.
    //
    // Документ читается напрямую, а указания к приёму, диагноз и общие
    // замечания хранятся зашифрованными: без расшифровки бланк печатал
    // в графе «Приём» строку вида "4c153d92…:7459bee…" вместо указаний.
    const prescription = decryptPrescriptionDoc(rx);

    // Пол, вес, телефон и аллергии тоже нужны бланку — раньше сюда
    // передавались только имя и дата рождения, и половина граф пустовала.
    const patient = await buildPatientForPdf(card);

    // Кто выписал: в рецепте лежат только идентификаторы.
    const prescriber = await resolvePrescriber(rx);

    // 5. Тот же генератор, что у клиники.
    const { buildPrescriptionPdf } =
      await import("../../clinic/clinic-medical/pdf/prescriptionPdf.js");

    const pdfBuffer = await buildPrescriptionPdf({
      prescription: { ...prescription, ...prescriber },
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
