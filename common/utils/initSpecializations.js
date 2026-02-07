// utils/initSpecializations.js
import Specialization, {
  SPECIALIZATIONS,
} from "../models/DoctorProfile/specialityOfDoctor.js"; // укажи свой путь

export const initializeSpecializations = async () => {
  try {
    const existingSpecializations = await Specialization.find({}, "name");

    const existingNames = new Set(
      existingSpecializations.map((spec) => spec.name)
    );

    const newSpecializations = SPECIALIZATIONS.filter(
      (spec) => !existingNames.has(spec.name)
    );

    if (newSpecializations.length > 0) {
      await Specialization.insertMany(newSpecializations);
      console.log(
        `✅ Добавлено новых специализаций: ${newSpecializations.length}`
      );
    } else {
      console.log(
        "ℹ️ Все специализации уже присутствуют. Ничего не добавлено."
      );
    }
  } catch (error) {
    console.error("❌ Ошибка при инициализации специализаций:", error);
  }
};
