import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import User from "../../../common/models/Auth/users.js";
import Article from "../../../common/models/Articles/articles.js";
import Specialization from "../../../common/models/DoctorProfile/specialityOfDoctor.js";

const AllDoctorController = async (req, res) => {
  try {
    const doctorsRaw = await DoctorProfile.find({})
      .populate({
        path: "userId",
        match: { role: "doctor" }, // 🎯 только доктора
        select: "firstNameEncrypted lastNameEncrypted specialization role",
      })
      .lean();

    // отбрасываем профили без привязанных докторов
    const doctors = doctorsRaw.filter((doc) => doc.userId);

    const doctorsWithDetails = await Promise.all(
      doctors.map(async (doctor) => {
        let firstName = "Неизвестно";
        let lastName = "";

        // получаем экземпляр пользователя (не .lean) для расшифровки
        const userDoc = await User.findById(doctor.userId._id);
        if (userDoc) {
          const decrypted = userDoc.decryptFields();
          firstName = decrypted.firstName || "Неизвестно";
          lastName = decrypted.lastName || "";
        }

        // находим специализацию по id
        let specializationName = "Не указана";
        if (doctor.userId.specialization) {
          const specialization = await Specialization.findById(
            doctor.userId.specialization
          ).lean();
          if (specialization) {
            specializationName = specialization.name;
          }
        }

        // считаем количество статей
        const articlesCount = await Article.countDocuments({
          authorId: doctor.userId._id,
        });

        return {
          _id: doctor._id,
          profileImage: doctor.profileImage,
          clinic: doctor.clinic,
          country: doctor.country,
          about: doctor.about,
          createdAt: doctor.createdAt,
          user: {
            firstName,
            lastName,
          },
          specialty: specializationName,
          articles: {
            count: articlesCount,
            link: `${req.protocol}://${req.get("host")}/articles?authorId=${
              doctor.userId._id
            }`,
          },
        };
      })
    );

    return res.status(200).json(doctorsWithDetails);
  } catch (error) {
    console.error("❌ Ошибка при получении докторов:", error);
    return res.status(500).json({ error: "Ошибка сервера" });
  }
};

export default AllDoctorController;
