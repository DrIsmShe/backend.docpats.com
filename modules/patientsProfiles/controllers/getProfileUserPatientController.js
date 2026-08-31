// server/modules/myClinic/controllers/getProfileUserPatientController.js
import mongoose from "mongoose";
import User from "../../../common/models/Auth/users.js";
import PatientProfile from "../../../common/models/PatientProfile/patientProfile.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import { tReq } from "../../../common/i18n/index.js";

const getProfileUserPatientController = async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🔍 Запрос профиля пациента: id=${id}`);

    // 1) Валидация ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: tReq(req, "app.validation.invalidId2") });
    }
    const userObjectId = new mongoose.Types.ObjectId(id);

    // 2) Пользователь с ролью patient
    const user = await User.findOne({ _id: userObjectId, role: "patient" });
    if (!user) {
      return res.status(404).json({ message: tReq(req, "app.patient.notFound") });
    }

    // 3) Расшифровка полей пользователя
    const decrypted =
      typeof user.decryptFields === "function"
        ? user.decryptFields()
        : {
            email: user.emailEncrypted,
            firstName: user.firstNameEncrypted,
            lastName: user.lastNameEncrypted,
          };

    // 4) Профиль (может отсутствовать)
    const patientProfile = await PatientProfile.findOne({
      userId: userObjectId,
    });

    // 5) Карта пациента в клинике (берём doc, затем toObject с getters+virtuals)
    const clinicDoc = await NewPatientPolyclinic.findOne({
      linkedUserId: userObjectId,
    });
    const clinicObj = clinicDoc
      ? clinicDoc.toObject({ getters: true, virtuals: true })
      : null;

    // 6) Телефон из клиники (страховка по путям)
    const phoneFromPolyclinic =
      clinicObj?.phoneNumber ??
      clinicDoc?.get?.("phoneEncrypted") ?? // getter вернёт расшифрованное
      clinicDoc?.phoneNumber ??
      undefined;

    // 7) Убираем лишние поля шифрования из ответа клиники
    if (clinicObj) {
      delete clinicObj.phoneEncrypted;
      delete clinicObj.phoneHash;
      delete clinicObj.emailEncrypted;
      delete clinicObj.emailHash;
      delete clinicObj.firstNameEncrypted;
      delete clinicObj.firstNameHash;
      delete clinicObj.lastNameEncrypted;
      delete clinicObj.lastNameHash;
    }

    // 8) Собираем профиль
    const userProfile = {
      id: user._id,
      email: decrypted.email || undefined,
      phoneNumber: phoneFromPolyclinic || undefined,
      firstName: decrypted.firstName,
      lastName: decrypted.lastName,
      avatar: user.avatar,
      dateOfBirth: user.dateOfBirth,
      bio: user.bio,
      registeredAt: user.registeredAt,
      status: user.status,
      lastActive: user.lastActive,
      preferredLanguage: user.preferredLanguage,
      country: user.country,
      company: user.company,
      patientProfile: patientProfile || null,
      newPatientPolyclinic: clinicObj || null,
    };

    return res.status(200).json(userProfile);
  } catch (error) {
    console.error("❌ Ошибка при получении профиля пациента:", error);
    return res.status(500).json({ message: tReq(req, "app.server.error") });
  }
};

export default getProfileUserPatientController;
