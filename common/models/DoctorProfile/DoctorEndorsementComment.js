import mongoose from "mongoose";

const DoctorEndorsementCommentSchema = new mongoose.Schema(
  {
    endorsementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DoctorEndorsement",
      required: true,
    },
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model(
  "DoctorEndorsementComment",
  DoctorEndorsementCommentSchema
);
