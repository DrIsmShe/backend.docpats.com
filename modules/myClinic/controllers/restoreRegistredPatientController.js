import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

const restoreRegisteredPatientController = async (req, res) => {
  try {
    const { id } = req.params;
    const doctorId = req.session.userId;

    if (!doctorId) {
      return res.status(403).json({ message: "Auth required" });
    }

    const patient = await NewPatientPolyclinic.findById(id);
    if (!patient) {
      return res.status(404).json({ message: "Patient not found" });
    }

    // 🔐 проверка, что пациент действительно принадлежит врачу
    if (!patient.doctorId.some((d) => d.toString() === doctorId)) {
      return res.status(403).json({ message: "Not your patient" });
    }

    // ✅ RESTORE
    patient.isArchived = false;
    patient.archivedAt = null;
    patient.archivedBy = null;

    await patient.save();

    return res.status(200).json({
      message: "Patient restored from archive",
      patientId: id,
    });
  } catch (err) {
    console.error("❌ Restore registered error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export default restoreRegisteredPatientController;
