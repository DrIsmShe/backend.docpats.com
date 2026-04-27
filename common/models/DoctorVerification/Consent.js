const ConsentSchema = new mongoose.Schema({
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

  type: {
    type: String,
    enum: ["data_processing", "ai_disclaimer", "terms"],
  },

  acceptedAt: Date,
  ip: String,
  userAgent: String,
});
