// server/modules/radiology/review/models/radiologyReviewItem.model.js
//
// Элемент «работы над ошибками» (spaced repetition) станции «Снимки». Кейс,
// который учащийся не сдал или где пропустил находки, попадает сюда и
// возвращается на повторение. Сдал чисто — интервал растёт (box 1→2→3),
// освоил на максимальном box — элемент удаляется.
//
// Один элемент на пару (userId, caseId).

import mongoose from "mongoose";

const { Schema } = mongoose;

const radiologyReviewItemSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // ref остаётся RadiologyCase: populate по этой ссылке нигде не делается, а
    // станция определяется полем station. Кейсы разных станций лежат в разных
    // коллекциях, поэтому пара (station, caseId) уникальна по-настоящему.
    caseId: { type: Schema.Types.ObjectId, ref: "RadiologyCase", required: true },
    // Станция арены: снимки, «Анализы», «Виртуальный пациент». Раньше очередь
    // была только у снимков — отсюда default.
    station: { type: String, enum: ["radiology", "labs", "vp"], default: "radiology", index: true },
    caseTitle: { type: String, default: "" },
    modality: { type: String, default: "" },

    // Ступень интервального повторения: 1 → через 1 день, 2 → 3 дня, 3 → 7.
    box: { type: Number, default: 1 },
    dueAt: { type: Date, required: true, index: true },
    lastScore: { type: Number, default: 0 }, // 0..1
  },
  { timestamps: true, collection: "radiology_review_items" },
);

radiologyReviewItemSchema.index({ userId: 1, station: 1, caseId: 1 }, { unique: true });
radiologyReviewItemSchema.index({ userId: 1, dueAt: 1 });

const RadiologyReviewItem =
  mongoose.models.RadiologyReviewItem ||
  mongoose.model("RadiologyReviewItem", radiologyReviewItemSchema, "radiology_review_items");

export default RadiologyReviewItem;
