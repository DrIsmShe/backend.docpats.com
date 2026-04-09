// DoctorDetailController.js
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import User from "../../../common/models/Auth/users.js";
import Article from "../../../common/models/Articles/articles.js";
import { decrypt } from "../../../common/utils/cryptoUtils.js";

const DoctorDetailController = async (req, res) => {
  try {
    const { id } = req.params;
    const sessionUserId = req.session.userId;

    if (!id) return res.status(400).json({ error: "Doctor ID not specified" });

    // 🔥 ВАЖНО: НЕ блокируем гостей
    let requestingUser = null;

    if (sessionUserId) {
      requestingUser = await User.findById(sessionUserId).lean();

      // ❌ пациентам запрещено
      if (requestingUser?.role === "patient") {
        return res
          .status(403)
          .json({ error: "Access denied: patients are not allowed" });
      }

      // ❌ если авторизован, но не doctor — тоже нельзя
      if (requestingUser?.role !== "doctor") {
        return res
          .status(403)
          .json({ error: "Access denied: only doctors allowed" });
      }
    }

    // сам профиль доктора
    const doc = await DoctorProfile.findById(id);
    if (!doc) return res.status(404).json({ error: "Doctor not found" });

    const doctor = doc.toObject({ virtuals: true });

    if (!doctor) return res.status(404).json({ error: "Doctor not found" });

    // пользователь-врач + специализация
    const user = await User.findById(doctor.userId)
      .populate("specialization", "name category")
      .lean();

    // статьи
    const articles = await Article.find({
      authorId: doctor.userId,
    }).lean();

    // нормализация для фронта
    const doctorDetails = {
      ...doctor,
      user: {
        ...user,
        firstName: user?.firstNameEncrypted
          ? decrypt(user.firstNameEncrypted)
          : null,
        lastName: user?.lastNameEncrypted
          ? decrypt(user.lastNameEncrypted)
          : null,
        specializationId: user?.specialization?._id ?? null,
        specializationName: user?.specialization?.name ?? null,
      },
      articles,
    };

    return res.status(200).json(doctorDetails);
  } catch (error) {
    console.error("❌ Error getting doctor details:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export default DoctorDetailController;
