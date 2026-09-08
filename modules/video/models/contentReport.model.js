// server/modules/video/models/contentReport.model.js
//
// Жалоба на опубликованный материал: ролик или комментарий под ним.
//
// ОДНА КОЛЛЕКЦИЯ НА ДВА ВИДА МАТЕРИАЛА. Разбирает жалобы один и тот же
// человек, в одном списке и по одним правилам; две коллекции означали бы
// две очереди, из которых вторую однажды перестанут открывать.
//
// ПОЧЕМУ ЖАЛОБА — ЭТО ДОКУМЕНТ, А НЕ ФЛАГ НА МАТЕРИАЛЕ. У жалобы своя
// судьба: кто пожаловался, на что именно, что ответил разбирающий и когда.
// Счётчик на ролике не отвечает ни на один из этих вопросов, а спросят
// именно их — особенно когда жалоба окажется на медицинскую ошибку.
//
// ТЕКСТ ЖАЛОБЫ — ЭТО ЧУЖИЕ СЛОВА. В нём может оказаться что угодно, включая
// сведения о здоровье, которые человек напишет по своей воле. Поэтому поле
// ограничено по длине, не индексируется и не попадает ни в какие выдачи,
// кроме страницы разбора.

import mongoose from "mongoose";

/* Причины. Список короткий и общий: длинный список причин не улучшает
   разбор, а заставляет жалующегося угадывать формулировку и бросать. */
export const ПРИЧИНЫ = [
  "medical", // недостоверные или опасные медицинские сведения
  "privacy", // раскрыты данные пациента
  "copyright", // чужой материал без прав
  "abuse", // оскорбления, травля
  "spam", // реклама, накрутка
  "sexual", // недопустимый характер материала
  "other",
];

export const СОСТОЯНИЯ = ["new", "reviewing", "resolved", "rejected"];

const contentReportSchema = new mongoose.Schema(
  {
    targetType: { type: String, enum: ["video", "comment"], required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },

    /* Ролик, к которому относится жалоба. Для комментария — ролик, под
       которым он оставлен: без этого разбирающий не поймёт контекста, а
       искать его по комментарию пришлось бы вручную. */
    videoId: { type: mongoose.Schema.Types.ObjectId, ref: "Video", default: null },

    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    reason: { type: String, enum: ПРИЧИНЫ, required: true },
    note: { type: String, trim: true, default: "", maxlength: 2000 },

    status: { type: String, enum: СОСТОЯНИЯ, default: "new", index: true },

    /* Итог разбора: кто, когда и что решил. Пустое решение при закрытом
       состоянии — незакрытая жалоба, поэтому проверяется ниже. */
    handledBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    handledAt: { type: Date, default: null },
    resolution: { type: String, trim: true, default: "", maxlength: 2000 },
  },
  { timestamps: true },
);

// Один человек — одна жалоба на материал: повторные нажатия не должны
// превращать одно возмущение в десять сигналов и двигать материал в
// очереди разбора.
contentReportSchema.index(
  { reporterId: 1, targetType: 1, targetId: 1 },
  { unique: true },
);

// Очередь разбора: сначала новые.
contentReportSchema.index({ status: 1, createdAt: -1 });

// Сколько жалоб на материал — вопрос, который задают на каждой странице
// разбора.
contentReportSchema.index({ targetType: 1, targetId: 1 });

contentReportSchema.pre("validate", function проверить(next) {
  const закрыта = this.status === "resolved" || this.status === "rejected";
  if (закрыта && !this.resolution?.trim()) {
    return next(
      new Error("Закрытая жалоба должна содержать решение: почему её закрыли"),
    );
  }
  if (закрыта && !this.handledBy) {
    return next(new Error("У закрытой жалобы должен быть разбирающий"));
  }
  return next();
});

export default mongoose.models.ContentReport ||
  mongoose.model("ContentReport", contentReportSchema);
