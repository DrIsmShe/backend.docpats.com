import User from "../../../common/models/Auth/users.js";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";

const detailUserUpdateController = async (req, res) => {
  try {
    const { userId } = req.params; // Получение ID пользователя из параметров URL
    const { isDoctor, ...updateData } = req.body; // Извлечение данных из тела запроса

    // Найти пользователя по ID
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Обновление данных пользователя
    Object.assign(user, updateData);
    await user.save();

    // Если пользователь - врач, обновляем профиль врача
    if (isDoctor) {
      let doctorProfile = await DoctorProfile.findOne({ userId });

      if (!doctorProfile) {
        // Создать новый профиль врача, если его нет
        doctorProfile = new DoctorProfile({
          userId,
          ...updateData,
        });

        await doctorProfile.save();
      } else {
        // Обновить существующий профиль врача
        await DoctorProfile.findByIdAndUpdate(doctorProfile._id, updateData, {
          new: true,
        });
      }
    }

    res.status(200).json({ message: "User data updated successfully" });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export default detailUserUpdateController;
