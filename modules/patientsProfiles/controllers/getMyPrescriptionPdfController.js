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
import DoctorPrivatePatient from "../../../common/models/Polyclinic/DoctorPrivatePatient.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import { tReq } from "../../../common/i18n/index.js";
import {
  buildPatientForPdf,
  decryptPrescriptionDoc,
  resolvePrescriber,
} from "../../clinic/clinic-medical/pdf/prescriptionPayload.js";

// Карта пациента по виду, записанному в самом рецепте.
async function loadCard(model, id) {
  if (model === "DoctorPrivatePatient") {
    return DoctorPrivatePatient.findById(id);
  }
  if (model === "NewPatientPolyclinic") {
    return NewPatientPolyclinic.findById(id);
  }
  // Клиническая карта закрыта арендой; здесь читает сам пациент, а не
  // клиника, поэтому скоуп снимаем — владение проверяется по linkedUserId.
  return ClinicPatient.findById(id).setOptions({ skipTenantScope: true });
}

const getMyPrescriptionPdfController = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: tReq(req, "app.validation.invalidIdFormat") });
    }

    const userId = req.user?.userId || req.session?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: tReq(req, "app.auth.notAuthorized2") });
    }

    // 1. Рецепт.
    const rx = await Prescription.findById(id).lean();
    if (!rx || !rx.patientRef) {
      return res.status(404).json({ ok: false, error: tReq(req, "app.prescription.notFound") });
    }

    // 2. Владение: карта рецепта привязана к этому пользователю.
    //
    // Карта может быть одной из трёх моделей — клиника, частный приём
    // врача, поликлиника, — и рецепт хранит её вид в patientTypeModel.
    // Проверять только клиническую карту значило бы отдавать 403 на
    // собственный рецепт пациента, выписанный врачом лично.
    const card = await loadCard(rx.patientTypeModel, rx.patientRef);

    if (!card || String(card.linkedUserId || "") !== String(userId)) {
      return res.status(403).json({ ok: false, error: tReq(req, "app.access.forbidden2") });
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
    // У карт врача аллергии лежат прямо в записи одной строкой, а у
    // клинической — отдельными записями, которые сборщик найдёт сам.
    const inlineAllergies =
      card.medicalProfile?.allergies || card.allergies || null;
    const patient = await buildPatientForPdf(
      card,
      inlineAllergies ? { allergies: inlineAllergies } : undefined,
    );

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
