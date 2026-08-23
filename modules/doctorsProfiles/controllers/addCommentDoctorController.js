import Comment from "../../../common/models/Comments/CommentDocpats.js";
import Article from "../../../common/models/Articles/articles.js";
import Notification from ".././../../common/models/Notification/notification.js";
import User from "../../../common/models/Auth/users.js";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import { eventBus } from "../../notifications/events/eventBus.js";

import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";

// Инициализация DOMPurify для защиты от XSS
const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window);

const addCommentDoctor = async (req, res) => {
  try {
    const { content, parentComment } = req.body; // данные из тела запроса
    const articleId = req.params.id; // ID статьи из URL
    const userId = req.session.userId; // ID пользователя из сессии

    // Проверяем аутентификацию
    if (!userId) {
      return res.status(403).json({ message: "Please log in." });
    }

    // Проверяем, существует ли статья и извлекаем автора
    const article = await Article.findById(articleId).populate("author");
    if (!article) {
      return res.status(404).json({ message: "Article not found" });
    }

    // Проверяем, что комментарий не пустой
    if (!content || content.trim() === "") {
      return res.status(400).json({ message: "Comment cannot be empty." });
    }

    // Очищаем контент от XSS
    const safeContent = DOMPurify.sanitize(content.trim());

    // Создаем новый комментарий
    const newComment = new Comment({
      content: safeContent,
      author: userId,
      article: articleId,
      parentComment: parentComment || null,
    });

    // Сохраняем комментарий
    await newComment.save();

    // Добавляем комментарий к статье
    await Article.findByIdAndUpdate(articleId, {
      $push: { comments: newComment._id },
    });

    // 🔹 Получаем данные пациента (автора комментария)
    const patient = await User.findById(userId).lean();

    // 🔹 Находим врача: сначала пробуем через User, потом через DoctorProfile
    let doctorUserId = null;
    let doctorFullName = "";

    if (article.author?.userId) {
      // Если в статье автор — это DoctorProfile
      const doctorProfile = await DoctorProfile.findById(article.author._id)
        .populate("userId")
        .lean();

      if (doctorProfile) {
        doctorUserId = doctorProfile.userId?._id?.toString();
        doctorFullName = `${doctorProfile.userId?.lastName || ""} ${
          doctorProfile.userId?.firstName || ""
        }`.trim();
      }
    } else {
      // Если автор — это User напрямую
      const doctorUser = await User.findById(article.author?._id).lean();
      if (doctorUser) {
        doctorUserId = doctorUser._id.toString();
        doctorFullName = `${doctorUser.lastName || ""} ${
          doctorUser.firstName || ""
        }`.trim();
      }
    }

    // 🔹 Создаём уведомление врачу
    if (doctorUserId && doctorUserId !== userId.toString()) {
      const notificationText = `Пациент ${patient?.lastName || ""} ${
        patient?.firstName || ""
      } оставил комментарий к вашему профилю.`;

      const newNotification = new Notification({
        userId: doctorUserId,
        senderId: userId,
        type: "doctorProfile.commented",
        title: "Новый комментарий к вашему профилю",
        message: notificationText,
        relatedArticleId: articleId,
        isRead: false,
      });

      await newNotification.save();

      // 🔹 Отправляем уведомление через eventBus (в реальном времени)
      eventBus.emit("doctorProfile.commented", {
        doctorUserId,
        doctorName: doctorFullName,
        patientId: userId,
        patientName: `${patient?.lastName || ""} ${
          patient?.firstName || ""
        }`.trim(),
        articleTitle: article.title,
        commentId: newComment._id,
        // Комментарий оставлен к СТАТЬЕ — пусть уведомление и ведёт к ней,
        // а не на профиль врача: обработчик выбирает адрес по этому полю.
        articleId,
      });
    }

    // Успешный ответ
    res.status(201).json({
      message: "Comment created and doctor notified",
      comment: newComment,
    });
  } catch (error) {
    console.error("❌ Error adding comment:", error);
    res.status(500).json({
      message: "Error creating comment",
      error: error.message,
    });
  }
};

export default addCommentDoctor;
