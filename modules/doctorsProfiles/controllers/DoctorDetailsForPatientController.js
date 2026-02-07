import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import User from "../../../common/models/Auth/users.js";
import Article from "../../../common/models/Articles/articles.js";

const DoctorDetailsForPatientController = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session.userId; // Берем userId только из сессии

    console.log("📌 Requesting doctor profile:");
    console.log("🔍 doctorId:", id);
    console.log("🔍 userId from session:", userId);

    if (!id) {
      console.error("❌ Error: Doctor ID not specified");
      return res.status(400).json({ error: "Doctor ID not specified" });
    }

    if (!userId) {
      console.error("❌ Error: userId missing in session");
      return res.status(403).json({ error: "Access denied: userId missing" });
    }

    // Получаем профиль доктора
    const doctor = await DoctorProfile.findById(id).lean();
    if (!doctor) {
      console.error("❌ Error: Doctor not found");
      return res.status(404).json({ error: "Doctor not found" });
    }

    // Get the user data associated with the doctor
    const user = await User.findById(doctor.userId).lean();

    // Check if the current user is a patient or a doctor
    const requestingUser = await User.findById(userId).lean();
    if (
      !requestingUser ||
      (requestingUser.role !== "doctor" && requestingUser.role !== "patient")
    ) {
      console.error(
        "❌ Error: Insufficient rights (role:",
        requestingUser?.role || "unknown",
        ")"
      );
      return res
        .status(403)
        .json({ error: "Access denied: insufficient rights" });
    }

    // Получаем статьи, написанные доктором
    const articles = await Article.find({ authorId: doctor.userId }).lean();

    // Формируем данные для ответа
    const doctorDetails = {
      ...doctor,
      user,
      articles,
    };

    console.log("✅ Doctor profile successfully sent");
    return res.status(200).json(doctorDetails);
  } catch (error) {
    console.error("❌ Error while retrieving doctor details:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export default DoctorDetailsForPatientController;
