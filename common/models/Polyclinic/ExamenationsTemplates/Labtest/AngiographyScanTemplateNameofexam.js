import mongoose from "mongoose";

const templateAngiographyScanSchema = new mongoose.Schema(
  {
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      trim: true,
    },
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

const AngiographyScanTemplateNameofexam =
  mongoose.models.AngiographyScanTemplateNameofexam ||
  mongoose.model(
    "AngiographyScanTemplateNameofexam",
    templateAngiographyScanSchema
  );

export default AngiographyScanTemplateNameofexam;
