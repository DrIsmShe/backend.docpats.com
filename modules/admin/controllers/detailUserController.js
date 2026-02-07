// controllers/admin/updateUserController.js
import User from "../../../common/models/Auth/users.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";

const DetailUserController = async (req, res) => {
  try {
    const { userId } = req.params; // Получаем userId из параметров URL

    // Находим пользователя по userId
    const user = await User.findById(userId).populate("doctorProfile"); // Используйте populate, если doctorProfile — это связаная модель.

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Если пользователь найден, возвращаем его данные
    res.status(200).json({
      userDetails: {
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        doctorProfile: user.doctorProfile, // Возвращаем информацию о докторе
      },
    });
  } catch (err) {
    console.error("Error retrieving user data:", err);
    res.status(500).json({ message: "Server error, try again later" });
  }
};

export default DetailUserController;
