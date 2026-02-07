import Notification from "../../../common/models/Notification/notification.js"; // Модель уведомлений

const sendMentionNotifications = async (mentions, commentId) => {
  for (let user of mentions) {
    const notification = new Notification({
      user: user._id,
      type: "mention",
      message: `Вы были упомянуты в комментарии.`,
      referenceId: commentId, // ID комментария, на который был ответ или упоминание
    });

    await notification.save();
  }
};
export default sendMentionNotifications;
