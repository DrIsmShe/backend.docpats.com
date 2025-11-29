import mongoose from "mongoose";

/**
 * 🧬 Семейная история заболеваний пациента
 * (для хранения данных о наследственных болезнях и рисках)
 */
const familyHistoryOfDiseasePatientSchema = new mongoose.Schema(
  {
    /**
     * 🔗 ID пациента (может иметь несколько записей)
     */
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NewPatientPolyclinic",
      required: true,
    },

    /**
     * 👨‍⚕️ Ссылка на лечащего врача
     */
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    /**
     * 👪 Родственник, у которого было заболевание (например, мать, отец)
     */
    relative: {
      type: String,
      trim: true,
      required: true,
    },

    /**
     * 🧠 Название или описание заболевания
     */
    diseaseName: {
      type: String,
      trim: true,
      required: true,
    },

    /**
     * 📝 Дополнительная информация
     */
    content: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

/**
 * ⚡ Индексы для ускоренного поиска по пациенту, врачу и родственнику
 */
familyHistoryOfDiseasePatientSchema.index({
  patientId: 1,
  doctorId: 1,
  relative: 1,
});

/**
 * 🧩 Безопасная регистрация модели
 * (исключает ошибку "Cannot overwrite model once compiled")
 */
const familyHistoryOfDiseasePatient =
  mongoose.models.familyHistoryOfDiseasePatient ||
  mongoose.model(
    "familyHistoryOfDiseasePatient",
    familyHistoryOfDiseasePatientSchema
  );

export default familyHistoryOfDiseasePatient;
