import mongoose from "mongoose";

const tempMRIResultsSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    tags: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

const TempMRIResult =
  mongoose.models.TempMRIResult ||
  mongoose.model("TempMRIResult", tempMRIResultsSchema);

export default TempMRIResult;
