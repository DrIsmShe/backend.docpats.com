import DoctorPrivatePatient from "../../../common/models/Polyclinic/DoctorPrivatePatient.js";

const restorePrivatePatientController = async (req, res) => {
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

    if (String(patient.doctorUserId) !== String(doctorUserId)) {
      return res.status(403).json({
        message: req.t("myClinic.patient.accessDenied"),
      });
    }

    if (!patient.isArchived) {
      return res.status(400).json({
        message: req.t("myClinic.patient.alreadyActive"),
      });
    }

    patient.isArchived = false;
    patient.archivedAt = null;
    patient.archiveReason = null;
    patient.updatedBy = doctorUserId;

    await patient.save();

    return res.status(200).json({
      message: req.t("myClinic.patient.restoredFromArchive"),
      patientId: id,
    });
  } catch (error) {
    console.error("❌ Ошибка восстановления пациента:", error);
    return res.status(500).json({
      message: req.t("myClinic.patient.restorationError"),
    });
  }
};

export default restorePrivatePatientController;
