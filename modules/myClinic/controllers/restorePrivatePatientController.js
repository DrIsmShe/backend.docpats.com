import DoctorPrivatePatient from "../../../common/models/Polyclinic/DoctorPrivatePatient.js";

const restorePrivatePatientController = async (req, res) => {
  try {
    const { id } = req.params;
    const doctorUserId = req.session.userId;

    if (!doctorUserId) {
      return res
        .status(403)
        .json({ message: "Пожалуйста, войдите в систему." });
    }

    const patient = await DoctorPrivatePatient.findById(id);

    if (!patient) {
      return res.status(404).json({ message: "Пациент не найден." });
    }

    if (String(patient.doctorUserId) !== String(doctorUserId)) {
      return res.status(403).json({
        message: "Вы не имеете доступа к этому пациенту.",
      });
    }

    if (!patient.isArchived) {
      return res.status(400).json({
        message: "Пациент уже активен.",
      });
    }

    patient.isArchived = false;
    patient.archivedAt = null;
    patient.archiveReason = null;
    patient.updatedBy = doctorUserId;

    await patient.save();

    return res.status(200).json({
      message: "Пациент восстановлен из архива.",
      patientId: id,
    });
  } catch (error) {
    console.error("❌ Ошибка восстановления пациента:", error);
    return res.status(500).json({
      message: "Ошибка сервера при восстановлении пациента.",
    });
  }
};

export default restorePrivatePatientController;
