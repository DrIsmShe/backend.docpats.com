import mongoose from "mongoose";

const { Schema, model } = mongoose;

const SimulationSchema = new Schema(
  {
    caseId: {
      type: Schema.Types.ObjectId,
      ref: "SurgicalCase",
      required: true,
      index: true,
    },
    surgeonId: { type: Schema.Types.ObjectId, required: true, index: true },

    // Исходное фото и маска
    sourcePhotoFilename: { type: String, required: true },
    maskFilename: { type: String },

    // Параметры генерации
    procedure: { type: String },
    // prompt — то, что реально ушло в модель изображений (по-английски,
    // как описание желаемого вида). promptRaw — то, что написал врач.
    //
    // Хранить оба обязательно. Без исходника невозможно понять, почему
    // результат не тот: виноват запрос врача или его перевод. А врачу
    // нужно видеть, что именно от его имени попросили у модели, — иначе
    // компилятор превращается в чёрный ящик, который «делает наоборот».
    prompt: { type: String },
    promptRaw: { type: String },
    promptCompiled: { type: Boolean, default: false },
    negativePrompt: { type: String },
    guidanceScale: { type: Number, default: 7.5 },
    steps: { type: Number, default: 25 },
    numOutputs: { type: Number, default: 4 },

    // Результаты
    resultFilenames: [{ type: String }],
    selectedIdx: { type: Number, default: null },

    // Статус
    status: {
      type: String,
      enum: ["pending", "processing", "done", "failed"],
      default: "pending",
      index: true,
    },

    // Replicate
    replicateId: { type: String },
    errorMessage: { type: String },

    // Юридический дисклеймер принят
    disclaimerAccepted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export default model("SurgerySimulation", SimulationSchema);
