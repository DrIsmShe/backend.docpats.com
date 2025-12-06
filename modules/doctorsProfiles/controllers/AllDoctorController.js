import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import User from "../../../common/models/Auth/users.js";
import Article from "../../../common/models/Articles/articles.js";
import Specialization from "../../../common/models/DoctorProfile/specialityOfDoctor.js";

/** Унифицированная функция нормализации URL */
const normalizeImageUrl = (raw, baseUrl) => {
  if (!raw) return null;

  let value = String(raw).trim();

  // ❗ Если это дефолтные картинки — НЕ использовать их
  if (
    value.includes("uploads/default") ||
    value.includes("default/doctor") ||
    (value.endsWith(".jpg") && value.includes("default"))
  ) {
    return null;
  }

  // уже абсолютный путь
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }

  value = value.replace(/^\/+/, "");
  if (!value.startsWith("uploads/")) {
    value = `uploads/${value}`;
  }

  const cleanBase = baseUrl.replace(/\/+$/, "");
  return `${cleanBase}/${value}`;
};

const AllDoctorController = async (req, res) => {
  try {
    const publicR2 = process.env.R2_PUBLIC_URL;

    const doctorsRaw = await DoctorProfile.find({})
      .populate({
        path: "userId",
        match: { role: "doctor" },
        select:
          "firstNameEncrypted lastNameEncrypted specialization role avatar",
      })
      .lean();

    const doctors = doctorsRaw.filter((doc) => doc.userId);

    const result = await Promise.all(
      doctors.map(async (doctor) => {
        let firstName = "Неизвестно",
          lastName = "";

        const userDoc = await User.findById(doctor.userId._id);
        if (userDoc?.decryptFields) {
          const decrypted = userDoc.decryptFields();
          firstName = decrypted.firstName || firstName;
          lastName = decrypted.lastName || lastName;
        }

        let specializationName = "Не указана";
        if (doctor.userId.specialization) {
          const spec = await Specialization.findById(
            doctor.userId.specialization
          ).lean();
          if (spec) specializationName = spec.name;
        }

        const articlesCount = await Article.countDocuments({
          authorId: doctor.userId._id,
        });

        const rawImage = doctor.profileImage || userDoc?.avatar || null;
        const profileImage = normalizeImageUrl(rawImage, publicR2);

        return {
          _id: doctor._id,
          profileImage,
          clinic: doctor.clinic,
          country: doctor.country,
          about: doctor.about,
          createdAt: doctor.createdAt,
          user: { firstName, lastName },
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

    return res.status(200).json(result);
  } catch (error) {
    console.error("❌ Ошибка при получении докторов:", error);
    return res.status(500).json({ error: "Ошибка сервера" });
  }
};

export default AllDoctorController;
