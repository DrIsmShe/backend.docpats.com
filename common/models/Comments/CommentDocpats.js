import mongoose from "mongoose";

const commentSchema = new mongoose.Schema(
  {
    content: {
      type: String,
      required: [true, "Комментарий не может быть пустым"],
      maxlength: 1000,
      trim: true,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    parentComment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CommentDocpats",
      default: null,
    },
    rootComment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CommentDocpats",
      default: null,
    },
    likes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    targetType: {
      type: String,
      required: true,
      enum: ["Doctor", "Article", "News", "ArticleScine"],
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    editedAt: {
      type: Date,
    },
    editedByAuthor: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toObject: { virtuals: true },
    toJSON: { virtuals: true },
  },
);

// 🧠 Виртуальное поле для вложенных ответов
commentSchema.virtual("replies", {
  ref: "CommentDocpats",
  localField: "_id",
  foreignField: "parentComment",
});

// ❤️ Метод для лайков/дизлайков
commentSchema.methods.toggleLike = async function (userId) {
  const index = this.likes.indexOf(userId);
  if (index === -1) {
    this.likes.push(userId);
  } else {
    this.likes.splice(index, 1);
  }
  await this.save();
  return this.likes.length;
};

// 🔍 Индексы для оптимизации
commentSchema.index({ targetId: 1, targetType: 1 });
commentSchema.index({ parentComment: 1 });
commentSchema.index({ rootComment: 1 });
commentSchema.index({ author: 1 });

export default mongoose.model("CommentDocpats", commentSchema);
