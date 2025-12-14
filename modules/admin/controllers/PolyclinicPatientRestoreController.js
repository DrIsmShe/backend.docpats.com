// server/modules/admin/controllers/PolyclinicPatientRestoreController.js
import mongoose from "mongoose";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import MedicalHistory from "../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";
import File from "../../../common/models/file.js";

/**
 * @route   PATCH /admin/polyclinic-patient-restore/:id
 * @desc    Восстанавливает пациента из архива (isDeleted=false)
 * @access  Admin / Doctor
 */
export const PolyclinicPatientRestoreController = async (req, res) => {
  try {
    const { id } = req.params;
    const isObjectId = mongoose.Types.ObjectId.isValid(id);

    // Ищем пациента (в том числе архивированного)
    const patient = await NewPatientPolyclinic.findOne(
      isObjectId ? { _id: id } : { patientUUID: id }
    );

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Пациент не найден.",
      });
    }

    if (!patient.isDeleted) {
      return res.status(400).json({
        success: false,
        message: "Пациент уже активен.",
      });
    }

    // ✅ Обновляем статус пациента
    await NewPatientPolyclinic.updateOne(
      { _id: patient._id },
      { $set: { isDeleted: false, deletedAt: null } }
    );

    // ✅ Снимаем архивный статус у связанных записей (если есть)
    await Promise.all([
      MedicalHistory.updateMany(
        { patientId: patient._id },
        { $set: { isArchived: false } }
      ),
      File.updateMany(
        { patientId: patient._id },
        { $set: { isArchived: false } }
      ),
    ]);

    console.log(
      `♻️ Пациент ${patient.fullName} (${patient._id}) восстановлен из архива.`
    );

    return res.status(200).json({
      success: true,
      message: "Пациент успешно восстановлен из архива.",
      restoredPatientId: patient._id,
    });
  } catch (error) {
    console.error("❌ Ошибка в PolyclinicPatientRestoreController:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при восстановлении пациента.",
      error: error.message,
    });
  }
};
