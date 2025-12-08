import Comment from "../../../../common/models/Comments/CommentDocpats.js";
import User, { decrypt } from "../../../../common/models/Auth/users.js";
import DoctorProfile from "../../../../common/models/DoctorProfile/profileDoctor.js";
import Notification from "../../../../common/models/Notification/notification.js";
import Article from "../../../../common/models/Articles/articles.js";
import { eventBus } from "../../../notifications/events/eventBus.js";

export const createComment = async (req, res) => {
  try {
    const {
      content,
      targetId,
      parentCommentId,
      targetType = "Article",
    } = req.body;
    const userId = req.user._id;

    // 🚫 Проверка на оскорбления
    const forbiddenWords = [
      "дурак",
      "тупой",
      "идиот",
      "сука",
      "черт",
      "fuck",
      "shit",
    ];
    const hasOffensive = forbiddenWords.some((w) =>
      content.toLowerCase().includes(w)
    );
    if (hasOffensive) {
      await User.findByIdAndUpdate(userId, {
        $inc: { offenseCount: 1 },
        lastOffenseAt: new Date(),
      });
      const user = await User.findById(userId);
      if (user.offenseCount >= 3) {
        user.permanentlyBanned = true;
        await user.save();
        return res
          .status(403)
          .json({ success: false, message: "Вы навсегда заблокированы" });
      }
      if (user.offenseCount === 2) {
        user.blockedUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        await user.save();
        return res
          .status(403)
          .json({ success: false, message: "Вы временно заблокированы" });
      }
      return res
        .status(400)
        .json({ success: false, message: "Обнаружен оскорбительный текст" });
    }

    // ✅ Создаём комментарий
    const comment = await Comment.create({
      content,
      author: userId,
      targetId,
      parentComment: parentCommentId || null,
      targetType,
    });

    // 🧩 Расшифровываем имя комментатора
    const commenter = await User.findById(userId);
    let decrypted = {
      firstName: "Пользователь",
      lastName: "",
      role: commenter?.role || "user",
    };
    try {
      decrypted = commenter?.decryptFields
        ? { ...commenter.decryptFields(), role: commenter.role }
        : {
            firstName: decrypt(commenter?.firstNameEncrypted),
            lastName: decrypt(commenter?.lastNameEncrypted),
            role: commenter.role,
          };
    } catch {
      decrypted = { firstName: "Пользователь", lastName: "", role: "user" };
    }

    // ======================================================
    // 1️⃣ Комментарий к статье
    // ======================================================
    if (!parentCommentId && targetType === "Article") {
      const article = await Article.findById(targetId).populate("authorId");

      let recipientUserId = null;
      let recipientDoctorProfileId = null;

      const possibleAuthorIds = [
        article?.authorId?.userId,
        article?.author?.userId,
        article?.authorId?._id,
        article?.author?._id,
      ].filter(Boolean);

      let doctorProfile = null;
      for (const id of possibleAuthorIds) {
        doctorProfile = await DoctorProfile.findOne({
          $or: [{ _id: id }, { userId: id }],
        })
          .populate("userId")
          .lean();
        if (doctorProfile) break;
      }

      if (doctorProfile) {
        recipientUserId = doctorProfile.userId?._id?.toString();
        recipientDoctorProfileId = doctorProfile._id?.toString();
      } else if (possibleAuthorIds.length > 0) {
        recipientUserId = possibleAuthorIds[0].toString();
      }

      if (recipientUserId && recipientUserId !== userId.toString()) {
        const isDoctor = decrypted.role === "doctor";
        const senderTitle = isDoctor
          ? `Доктор ${decrypted.lastName} ${decrypted.firstName}`
          : `Пациент ${decrypted.lastName} ${decrypted.firstName}`;
        // ✅ Формируем корректный текст
        const notificationText = `${senderTitle} оставил комментарий к вашей статье «${article.title}».`;

        await Notification.create({
          userId: recipientUserId,
          senderId: userId,
          type: "comment", // ✅ правильный тип для статьи
          title: "Новый комментарий к вашей статье",
          message: notificationText.replace("профилю", "статье"),
          link: `/doctor/article-detail/${targetId}`,
          icon: "chat-left-text",
          priority: "normal",
          isRead: false,
        });

        if (global.io) {
          global.io.to(recipientUserId.toString()).emit("new_notification", {
            title: "Комментарий",
            message: notificationText,
          });
        }

        console.log("✅ Уведомление врачу (статья) создано:", recipientUserId);
      }
    }

    // ======================================================
    // 2️⃣ Комментарий к профилю врача
    // ======================================================
    // ======================================================
    // 2️⃣ Комментарий к профилю врача
    // ======================================================
    if (!parentCommentId && targetType === "Doctor") {
      // 1️⃣ Находим профиль врача
      const doctorProfile = await DoctorProfile.findById(targetId).populate(
        "userId"
      );

      if (doctorProfile && doctorProfile.userId) {
        const doctorUser = doctorProfile.userId;
        const doctorUserId = doctorUser._id.toString();
        const commenterUserId = userId.toString();

        // 2️⃣ Имя автора комментария
        const commenterName = `${decrypted.lastName || ""} ${
          decrypted.firstName || ""
        }`.trim();

        // 3️⃣ Имя врача (расшифровка)
        let doctorFirst = "Доктор";
        let doctorLast = "";
        try {
          doctorFirst = doctorUser.firstNameEncrypted
            ? decrypt(doctorUser.firstNameEncrypted)
            : doctorUser.firstName || "Доктор";
          doctorLast = doctorUser.lastNameEncrypted
            ? decrypt(doctorUser.lastNameEncrypted)
            : doctorUser.lastName || "";
        } catch (e) {
          console.warn("⚠ Ошибка расшифровки имени врача:", e);
        }
        const doctorName = `${doctorLast} ${doctorFirst}`.trim();

        const isSelfComment = doctorUserId === commenterUserId;

        // =========================================================
        // 🔔 A) Уведомление врачу (если коммент оставил НЕ он сам)
        // =========================================================
        if (!isSelfComment) {
          const notifyToDoctor = {
            userId: doctorUserId,
            senderId: commenterUserId,
            type: "doctorProfile.commented",
            title: "Новый комментарий к вашему профилю",
            message: `${
              decrypted.role === "doctor" ? "Доктор" : "Пациент"
            } ${commenterName} оставил комментарий к вашему профилю.`,
            link: `/doctor/profile/comments/${comment._id}`,
            icon: "chat-left-text",
            priority: "normal",
            isRead: false,
            updatedAt: new Date(),
          };

          // upsert вместо create → исключает дубль и E11000
          await Notification.findOneAndUpdate(
            {
              userId: doctorUserId,
              senderId: commenterUserId,
              type: "doctorProfile.commented",
            },
            { $set: notifyToDoctor },
            { upsert: true, new: true }
          );

          if (global.io) {
            global.io.to(doctorUserId).emit("new_notification", {
              title: notifyToDoctor.title,
              message: notifyToDoctor.message,
            });
          }

          console.log("🔔 Уведомление врачу отправлено:", doctorUserId);
        }

        // =========================================================
        // ✉️ B) Уведомление автору комментария (всегда)
        // =========================================================
        const notifyToAuthor = {
          userId: commenterUserId,
          senderId: doctorUserId,
          type: "doctorProfile.commentSent",
          title: "Комментарий отправлен",
          message: `Вы оставили комментарий к профилю доктора ${doctorName}.`,
          link: `/doctor/profile/${targetId}`,
          icon: "send",
          priority: "low",
          isRead: false,
          updatedAt: new Date(),
        };

        await Notification.findOneAndUpdate(
          {
            userId: commenterUserId,
            senderId: doctorUserId,
            type: "doctorProfile.commentSent",
          },
          { $set: notifyToAuthor },
          { upsert: true, new: true }
        );

        if (global.io) {
          global.io.to(commenterUserId).emit("new_notification", {
            title: notifyToAuthor.title,
            message: notifyToAuthor.message,
          });
        }

        console.log("📨 Уведомление автору отправлено:", commenterUserId);
      } else {
        console.warn("⚠ Профиль врача не найден для targetId:", targetId);
      }
    }

    // ======================================================
    // 3️⃣ Ответ на комментарий
    // ======================================================

    if (parentCommentId) {
      const parentComment = await Comment.findById(parentCommentId)
        .populate({ path: "author", select: "_id role" })
        .lean();

      if (
        parentComment?.author?._id &&
        parentComment.author._id.toString() !== userId.toString()
      ) {
        const actorTitle =
          decrypted.role === "doctor"
            ? `Доктор ${decrypted.lastName} ${decrypted.firstName}`
            : `Пациент ${decrypted.lastName} ${decrypted.firstName}`;

        // 🔥 ДЕЛАЕМ УНИКАЛЬНОЕ СООБЩЕНИЕ (ИСПРАВЛЕНИЕ!)
        const replyMessage = `${actorTitle} ответил на ваш комментарий (#${comment._id})`;

        const recipientUserId = parentComment.author._id;

        const replyNotification = await Notification.create({
          userId: recipientUserId,
          senderId: userId,
          type: "comment_reply",
          title: "Новый ответ на комментарий",
          message: replyMessage, // ← Больше никогда не будет дубликатов
          link: `/comments/${parentCommentId}`,
          icon: "reply",
          priority: "normal",
          isRead: false,
        });

        if (global.io) {
          global.io
            .to(recipientUserId.toString())
            .emit("new_notification", replyNotification);
        }
      }
    }

    return res.status(201).json({ success: true, comment });
  } catch (err) {
    console.error("💥 Ошибка создания комментария:", err);
    return res
      .status(500)
      .json({ success: false, message: "Ошибка при создании комментария" });
  }
};

export const getCommentsByRef = async (req, res) => {
  try {
    const { refId } = req.params;

    // 🔹 Получаем все комментарии по цели (Doctor, Article, News)
    const allComments = await Comment.find({ targetId: refId })
      .populate(
        "author",
        "firstNameEncrypted lastNameEncrypted avatar username"
      )
      .sort({ createdAt: -1 }) // 🔄 Новые сверху
      .lean();

    const commentMap = {};

    // 🔹 Расшифровка имён и подготовка карты
    allComments.forEach((comment) => {
      comment.replies = [];

      if (comment.author?.firstNameEncrypted) {
        const decrypted = comment.author.decryptFields
          ? comment.author.decryptFields()
          : {
              firstName: decrypt(comment.author.firstNameEncrypted),
              lastName: decrypt(comment.author.lastNameEncrypted),
            };

        comment.author.firstName = decrypted.firstName;
        comment.author.lastName = decrypted.lastName;
      }

      commentMap[comment._id.toString()] = comment;
    });

    const rootComments = [];

    // 🔹 Формируем иерархию и вставляем инфо о родителях
    for (const comment of allComments) {
      if (comment.parentComment) {
        const parent = commentMap[comment.parentComment.toString()];

        if (parent) {
          const parentAuthor =
            parent.author?.decryptFields?.() ||
            (parent.author?.firstNameEncrypted
              ? {
                  firstName: decrypt(parent.author.firstNameEncrypted),
                  lastName: decrypt(parent.author.lastNameEncrypted),
                }
              : { firstName: "Аноним", lastName: "" });

          comment.parentAuthor = {
            firstName: parentAuthor.firstName,
            lastName: parentAuthor.lastName,
          };

          comment.parentContent =
            parent.content?.length > 100
              ? parent.content.slice(0, 100) + "..."
              : parent.content;

          parent.replies.push(comment);
        }
      } else {
        rootComments.push(comment);
      }
    }

    res.status(200).json({ success: true, comments: rootComments });
  } catch (err) {
    console.error("❌ Ошибка при получении комментариев:", err);
    res.status(500).json({
      success: false,
      message: "Ошибка при получении комментариев",
      error: err.message,
    });
  }
};

// ✏️ Редактирование комментария
export const updateComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const { content } = req.body;
    const userId = req.user._id;

    const comment = await Comment.findById(commentId);
    if (!comment)
      return res
        .status(404)
        .json({ success: false, message: "Комментарий не найден" });

    const maxEditTime = 15 * 60 * 1000;
    if (
      comment.author.toString() !== userId.toString() ||
      Date.now() - comment.createdAt > maxEditTime
    ) {
      return res
        .status(403)
        .json({ success: false, message: "Редактирование недоступно" });
    }

    comment.content = content;
    comment.editedAt = new Date();
    comment.editedByAuthor = true;
    await comment.save();

    return res.status(200).json({ success: true, comment });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Ошибка при редактировании",
      error: err.message,
    });
  }
};

// ❌ Удаление комментария
export const deleteComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user._id;

    const comment = await Comment.findById(commentId);
    if (!comment)
      return res
        .status(404)
        .json({ success: false, message: "Комментарий не найден" });

    if (comment.author.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Вы не можете удалить этот комментарий",
      });
    }

    await comment.deleteOne();
    return res
      .status(200)
      .json({ success: true, message: "Комментарий удален" });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Ошибка при удалении",
      error: err.message,
    });
  }
};

// ❤️ Лайк / дизлайк
export const toggleLike = async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user._id;

    const comment = await Comment.findById(commentId);
    if (!comment)
      return res
        .status(404)
        .json({ success: false, message: "Комментарий не найден" });

    const index = comment.likes.indexOf(userId);
    if (index === -1) {
      comment.likes.push(userId);
    } else {
      comment.likes.splice(index, 1);
    }

    await comment.save();
    return res.status(200).json({ success: true, likes: comment.likes.length });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Ошибка при лайке",
      error: err.message,
    });
  }
};

// Получение количества комментариев (включая ответы)
export const getCommentCountBulk = async (req, res) => {
  try {
    const { ids } = req.body; // массив targetId
    if (!Array.isArray(ids)) {
      return res
        .status(400)
        .json({ success: false, message: "ids должен быть массивом" });
    }

    const counts = {};

    for (const id of ids) {
      const count = await Comment.countDocuments({ targetId: id });
      counts[id] = count;
    }

    return res.status(200).json({ success: true, counts });
  } catch (err) {
    console.error("❌ Ошибка при получении количества комментариев:", err);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера",
      error: err.message,
    });
  }
};

// backend/controllers/commentController/commentController.js
export const getCommentCountDetail = async (req, res) => {
  try {
    const { targetId } = req.params;
    const count = await Comment.countDocuments({ targetId });
    return res.status(200).json({ count }); // ✅ важно, чтобы возвращался именно объект { count }
  } catch (err) {
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};
