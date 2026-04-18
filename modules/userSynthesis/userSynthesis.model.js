import mongoose from "mongoose";

const userSynthesisSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    specialty: { type: String, default: "Общая медицина" },
    language: { type: String, default: "ru" },
    wordCount: { type: Number },
    style: { type: String },
    isPublic: { type: Boolean, default: false }, // врач может опубликовать
    sources: [
      {
        title: { type: String },
        url: { type: String },
        authors: { type: String },
        year: { type: Number },
        _id: false,
      },
    ],
    status: {
      type: String,
      enum: ["published", "draft"],
      default: "published",
    },
  },
  { timestamps: true },
);

userSynthesisSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model("UserSynthesis", userSynthesisSchema);
