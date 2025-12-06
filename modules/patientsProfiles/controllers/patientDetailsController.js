import mongoose from "mongoose";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

// 🔍 Контроллер получения данных пациента (для фронта /patient-profile/patient-details/:id)
const patientDetailsController = async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`📥 Получен запрос данных пациента: ${id}`);

    // ✅ Проверка ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Неверный ID пациента" });
    }
    const objId = new mongoose.Types.ObjectId(id);

    // 🔎 Ищем по linkedUserId ИЛИ по _id
    const patientDoc = await NewPatientPolyclinic.findOne({
      $or: [{ linkedUserId: objId }, { _id: objId }],
    });

    if (!patientDoc) {
      console.warn("❌ Пациент не найден в базе");
      return res.status(404).json({ exists: false });
    }

    console.log("✅ Пациент найден:", patientDoc.patientUUID);

    // 🧾 Превращаем документ в POJO с ГЕТТЕРАМИ и ВИРТУАЛАМИ
    // это важно: email/phone вернутся уже РАСШИФРОВАННЫМИ,
    // а виртуал phoneNumber отдаст расшифрованный телефон
    const p = patientDoc.toObject({ getters: true, virtuals: true });

    // Имя/фамилия/ФИО
    const firstName = p.firstName || "";
    const lastName = p.lastName || "";
    const fullName =
      p.fullName || [firstName, lastName].filter(Boolean).join(" ");

    // Фото → абсолютный URL
    const photoUrl = (() => {
      const url = p.photo;
      if (!url) return "http://localhost:11000/uploads/default.png";
      if (typeof url === "string" && url.startsWith("http")) return url;
      if (typeof url === "string" && url.startsWith("/"))
        return `http://localhost:11000${url}`;
      return `http://localhost:11000/uploads/${url}`;
    })();

    // 📤 Ответ, совместимый с фронтом
    const result = {
      exists: true,
      patientUUID: p.patientUUID,
      firstName,
      lastName,
      fullName,
      email: p.email, // из алиаса email → расшифрованный
      phoneNumber: p.phoneNumber, // из виртуала phoneNumber → расшифрованный
      country: p.country || "",
      clinic: p.clinic || "",
      about: p.about || "",
      photo: photoUrl,
    };

    console.log("📤 Отправка данных пациента:", result);
    return res.status(200).json(result);
  } catch (error) {
    console.error("💥 Ошибка в контроллере patientDetails:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
};

export default patientDetailsController;
