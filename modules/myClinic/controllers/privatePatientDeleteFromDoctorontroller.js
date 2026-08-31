import DoctorPrivatePatient from "../../../common/models/Polyclinic/DoctorPrivatePatient.js";

const privatePatientDeleteFromDoctorController = async (req, res) => {
  try {
    const { id } = req.params;
    const doctorUserId = req.session.userId;

    if (!doctorUserId) {
      return res
        .status(403)
        .json({ message: req.t("myClinic.auth.pleaseLogin") });
    }

    const patient = await DoctorPrivatePatient.findById(id);

    if (!patient) {
      return res.status(404).json({ message: req.t("myClinic.patient.notFound") });
    }

    // 🔒 Проверка владельца private-пациента
    if (String(patient.doctorUserId) !== String(doctorUserId)) {
      return res.status(403).json({
        message: req.t("myClinic.patient.accessDenied"),
      });
    }

    // ✅ Архивируем, а не удаляем
    patient.isArchived = true;
    patient.archivedAt = new Date();
    patient.archiveReason = "Removed from doctor private list";
    patient.updatedBy = doctorUserId;

    await patient.save();

    return res.status(200).json({
      message: req.t("myClinic.patient.privateArchived"),
      patientId: id,
    });
  } catch (error) {
    console.error("❌ Ошибка при удалении private пациента:", error);
    return res
      .status(500)
      .json({ message: req.t("myClinic.patient.deletionError") });
  }
};

export default privatePatientDeleteFromDoctorController;
