// DoctorDetailController.js
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import User from "../../../common/models/Auth/users.js";
import Article from "../../../common/models/Articles/articles.js";
import { decrypt } from "../../../common/utils/cryptoUtils.js"; // ← обязательно

const DoctorDetailController = async (req, res) => {
  try {
    const { id } = req.params;
    const sessionUserId = req.session.userId;

    if (!id) return res.status(400).json({ error: "Doctor ID not specified" });
    if (!sessionUserId)
      return res.status(403).json({ error: "Access denied: userId missing" });

    // сам профиль доктора
    // сам профиль доктора
    const doc = await DoctorProfile.findById(id);
    if (!doc) return res.status(404).json({ error: "Doctor not found" });

    const doctor = doc.toObject({ virtuals: true });

    if (!doctor) return res.status(404).json({ error: "Doctor not found" });

    // пользователь-врач + подтягиваем специализацию
    const user = await User.findById(doctor.userId)
      .populate("specialization", "name category") // ← вот это главное
      .lean();

    // права (как у тебя было)
    const requestingUser = await User.findById(sessionUserId).lean();
    if (
      !requestingUser ||
      !["doctor", "patient"].includes(requestingUser.role)
    ) {
      return res
        .status(403)
        .json({ error: "Access denied: insufficient rights" });
    }

    // статьи
    const articles = await Article.find({ authorId: doctor.userId }).lean();

    // нормализация для фронта
    const doctorDetails = {
      ...doctor,
      user: {
        ...user,
        firstName: decrypt(user.firstNameEncrypted),
        lastName: decrypt(user.lastNameEncrypted),
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
