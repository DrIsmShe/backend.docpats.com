import mongoose from "mongoose";

const templateCTScanSchema = new mongoose.Schema(
  {
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: { type: String, required: true },
    content: { type: String, required: true },
  },
  { timestamps: true }
);

// Регистрация через `mongoose.models.X || …`, а не голым
// mongoose.model(). Голая форма бросает OverwriteModelError, если это имя
// уже занято, — а занять его успевал дубликат из соседней папки
// ScansTemplates/ (удалён). Кто из двух побеждал, решал порядок обхода
// каталога в ModelLoader, то есть файловая система: на одной машине
// работало, на другой упало бы при старте, и упало бы молча — загрузчик
// ловит ошибку файла и идёт дальше.
const CTScanTemplateRecomandation =
  mongoose.models.CTScanTemplateRecomandation ||
  mongoose.model("CTScanTemplateRecomandation", templateCTScanSchema);

export default CTScanTemplateRecomandation;
