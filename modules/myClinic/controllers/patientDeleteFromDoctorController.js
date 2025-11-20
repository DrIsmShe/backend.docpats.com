import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

const patientDeleteFromDoctorController = async (req, res) => {
  try {
    const { id } = req.params;
    const doctorId = req.session.userId;

    if (!doctorId) {
      return res
        .status(403)
        .json({ message: "Пожалуйста, войдите в систему." });
    }

    if (!id) {
      return res.status(400).json({ message: "ID пациента не указан." });
    }

    // Находим пациента
    const patient = await NewPatientPolyclinic.findById(id);
    if (!patient) {
      return res.status(404).json({ message: "Пациент не найден." });
    }

    // Проверяем, прикреплен ли пациент к данному врачу
    if (!patient.doctorId.includes(doctorId)) {
      return res
        .status(403)
        .json({ message: "Этот пациент не прикреплен к вам." });
    }

    // Удаляем врача из списка doctorId у пациента
    patient.doctorId = patient.doctorId.filter(
      (docId) => docId.toString() !== doctorId
    );

    // Если после удаления массив doctorId пустой, устанавливаем его в []
    if (!patient.doctorId || patient.doctorId.length === 0) {
      patient.doctorId = [];
    }

    await patient.save();

    return res.status(200).json({
      message: "Пациент успешно удален из списка вашего кабинета.",
      patientId: id,
    });
  } catch (error) {
    console.error("❌ Ошибка при удалении пациента:", error);
    return res
      .status(500)
      .json({ message: "Ошибка сервера при удалении пациента." });
  }
};
export default patientDeleteFromDoctorController;
