// server/modules/video/models/videoSubscription.model.js
//
// Подписка зрителя на канал — врача или клинику.
//
// ЗАЧЕМ ОТДЕЛЬНАЯ КОЛЛЕКЦИЯ, А НЕ МАССИВ В ПРОФИЛЕ. Популярный канал
// собирает десятки тысяч подписчиков, а документ Mongo ограничен 16 МБ и
// целиком читается при каждом обращении к профилю. Отдельные записи растут
// вбок и считаются индексом, а не перебором.
//
// КАНАЛ — ЭТО НЕ ТОЛЬКО ПОЛЬЗОВАТЕЛЬ. Ролик принадлежит либо врачу, либо
// клинике (см. авторыДля в video.service.js), и подписываться человек хочет
// именно на то имя, которое видит под роликом. Отсюда пара channelType +
// channelId вместо одной ссылки на User.
//
// ПОДПИСЫВАЕТСЯ ТОЛЬКО ПОЛЬЗОВАТЕЛЬ. Сотрудник клиники работает от лица
// организации; личная лента подписок у рабочей учётки смысла не имеет.

import mongoose from "mongoose";

const videoSubscriptionSchema = new mongoose.Schema(
  {
    subscriberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    channelType: { type: String, enum: ["user", "clinic"], required: true },
    channelId: { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

// Одна подписка на канал: повторное нажатие «Подписаться» из двух вкладок
// не должно превращаться в двух подписчиков.
videoSubscriptionSchema.index(
  { subscriberId: 1, channelType: 1, channelId: 1 },
  { unique: true },
);

// Счётчик подписчиков канала и лента «мои подписки» — два запроса, ради
// которых коллекция и существует.
videoSubscriptionSchema.index({ channelType: 1, channelId: 1 });

export default mongoose.models.VideoSubscription ||
  mongoose.model("VideoSubscription", videoSubscriptionSchema);
