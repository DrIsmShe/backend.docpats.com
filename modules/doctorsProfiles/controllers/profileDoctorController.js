import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";

// Контроллер для создания профиля доктора
const ProfileControllerDoctor = async (req, res) => {
  if (!req.session.userId) {
    console.log("Error: User not authenticated.");
    return res.status(403).json({ message: "Please sign in." });
  }
  console.log("ProfileControllerDoctor controller called"); // Debug message
  console.log("Request data:", req.body); // Log the received data

  try {
    // Ваша логика контроллера
    const {
      company,
      speciality,
      address,
      phone,
      clinic,
      about,
      country,
      twitter,
      facebook,
      instagram,
      linkedin,
    } = req.body.data;

    const doctorProfile = new ProfileDoctor({
      userId: req.session.userId,
      company,
      speciality,
      address,
      phone,
      clinic,
      //profileImage, // Путь к изображению, если оно загружено
      about,
      country,
      twitter,
      facebook,
      instagram,
      linkedin,
    });
    // Сохраняем профиль в базе данных
    await doctorProfile.save();
    res.status(200).json({ message: "Profile updated" });
  } catch (error) {
    res.status(500).json({ message: "Error updating profile" });
  }
};

export default ProfileControllerDoctor;
