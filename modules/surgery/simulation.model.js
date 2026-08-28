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

    // full — правка снимка целиком по инструкции, как в ChatGPT: модель
    // сама находит анатомию, маска не нужна. masked — правка ограничена
    // отмеченной зоной, и кадр собирается по маске из оригинала.
    mode: { type: String, enum: ["full", "masked"], default: "full" },

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

    // promptFinal — строка, реально ушедшая в модель изображений: prompt
    // плюс описание человека на снимке. Хранится отдельно от prompt,
    // потому что описание добавляется уже в воркере (там читается файл),
    // а врачу показать нужно именно итог: по нему видно, знала ли модель,
    // кого рисует.
    promptFinal: { type: String },
    subjectDescription: { type: String },

    // Геометрия правки. Без этих чисел разбор жалобы «получился другой
    // человек» упирается в чтение логов воркера, которых у врача нет:
    // маска 300×150 вместо 452×679 или закрашенные полкадра видны здесь
    // сразу и объясняют результат целиком.
    maskStats: {
      width: { type: Number },
      height: { type: Number },
      paintedPct: { type: Number },
    },
    cropRegion: {
      left: { type: Number },
      top: { type: Number },
      width: { type: Number },
      height: { type: Number },
    },
    provider: { type: String },
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
