import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

const patientArchiveFromDoctorController = async (req, res) => {
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

    if (!patient.doctorId.some((d) => d.toString() === doctorId)) {
      return res.status(403).json({ message: "Not your patient" });
    }

    // ✅ ВОТ ГЛАВНОЕ
    patient.isArchived = true;
    patient.archivedAt = new Date();

    await patient.save();

    return res.status(200).json({
      message: "Patient archived",
      patientId: id,
    });
  } catch (err) {
    console.error("❌ Archive error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export default patientArchiveFromDoctorController;
