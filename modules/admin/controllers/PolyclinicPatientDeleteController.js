// server/modules/admin/controllers/PolyclinicPatientDeleteController.js
import mongoose from "mongoose";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import MedicalHistory from "../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";
import File from "../../../common/models/file.js";

/**
 * @route   DELETE /admin/polyclinic-patient-delete/:id
 * @desc    Архивирует пациента (isDeleted=true) без вызова .save()
 * @access  Admin / Doctor
 */
export const PolyclinicPatientDeleteController = async (req, res) => {
  try {
    const { id } = req.params;
    const isObjectId = mongoose.Types.ObjectId.isValid(id);

    const patient = await NewPatientPolyclinic.findOne(
      isObjectId ? { _id: id } : { patientUUID: id }
    );

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Пациент не найден.",
      });
    }

    if (patient.isDeleted) {
      return res.status(400).json({
        success: false,
        message: "Пациент уже архивирован.",
      });
    }

    // ✅ обновляем напрямую, без .save()
    await NewPatientPolyclinic.updateOne(
      { _id: patient._id },
      { $set: { isDeleted: true, deletedAt: new Date() } }
    );

    // Опционально — архивируем связанные записи
    await Promise.all([
      MedicalHistory.updateMany(
        { patientId: patient._id },
        { $set: { isArchived: true } }
      ),
      File.updateMany(
        { patientId: patient._id },
        { $set: { isArchived: true } }
      ),
    ]);

    console.log(
      `📦 Пациент ${patient.patientId} (${patient._id}) архивирован (${patient.fullName}).`
    );

    return res.status(200).json({
      success: true,
      message: "Пациент успешно архивирован.",
      deletedPatientId: patient._id,
    });
  } catch (error) {
    console.error("❌ Ошибка в PolyclinicPatientDeleteController:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при архивировании пациента.",
      error: error.message,
    });
  }
};
