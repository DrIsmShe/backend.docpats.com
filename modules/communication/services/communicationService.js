// server/modules/communications/services/communicationService.js
import Room from "../../../common/models/Communication/Room.js";
import Participant from "../../../common/models/Communication/Participant.js";
import Message from "../../../common/models/Communication/message.js";
import User from "../../../common/models/Auth/users.js";
import Notification from "../../../common/models/Notification/notification.js";
import { decrypt } from "../../../common/utils/cryptoUtils.js";

/**
 * 1️⃣ Создание комнаты общения (чат / консультация / консилиум)
 */
export const createRoom = async ({
  userId,
  userRole,
  type,
  title,
  description,
  appointmentId,
  patientId,
  doctorIds = [],
  settings = {},
}) => {
  const allIds = [...doctorIds, patientId].filter(Boolean);
  const users = await User.find({ _id: { $in: allIds } })
    .select("_id role firstNameEncrypted lastNameEncrypted avatar")
    .lean();

  if (users.length !== allIds.length)
    throw new Error("Некоторые участники не найдены");

  const existingRoom = await Room.findOne({
    type,
    appointmentId,
    patientId,
    doctorIds: { $all: doctorIds },
  });

  if (existingRoom) return { existing: true, room: existingRoom };

  const room = await Room.create({
    type,
    title,
    description,
    appointmentId,
    patientId,
    doctorIds,
    createdBy: userId,
    settings,
  });

  const participants = [
    { roomId: room._id, userId, role: userRole, isOnline: true },
    ...users.map((u) => ({
      roomId: room._id,
      userId: u._id,
      role: u.role,
      isOnline: false,
    })),
  ];
  await Participant.insertMany(participants);

  const notifications = users
    .filter((u) => u._id.toString() !== userId.toString())
    .map((u) => ({
      userId: u._id,
      senderId: userId,
      type: "communication.roomCreated",
      title: userRole === "doctor" ? "Онлайн-консультация" : "Создан новый чат",
      message:
        userRole === "doctor"
          ? "Ваш врач создал комнату для консультации"
          : "Вы приглашены в новую комнату общения",
      link: `/chat/${room._id}`,
      icon: "comments",
      priority: "normal",
    }));

  if (notifications.length) await Notification.insertMany(notifications);

  return { room, participants };
};

/**
 * 2️⃣ Добавление участника в комнату
 */
export const addParticipant = async ({
  currentUserId,
  roomId,
  userId,
  role,
}) => {
  const room = await Room.findById(roomId);
  if (!room) throw new Error("Комната не найдена");

  const currentParticipant = await Participant.findOne({
    roomId,
    userId: currentUserId,
  });
  if (!currentParticipant || currentParticipant.role === "patient")
    throw new Error("Нет прав на добавление участников");

  const currentCount = await Participant.countDocuments({ roomId });
  const max = room.settings?.maxParticipants || 10;
  if (currentCount >= max)
    throw new Error(`Лимит участников (${max}) достигнут`);

  const exists = await Participant.findOne({ roomId, userId });
  if (exists) return { already: true };

  const user = await User.findById(userId)
    .select("_id role firstNameEncrypted lastNameEncrypted avatar")
    .lean();
  if (!user) throw new Error("Пользователь не найден");

  const participant = await Participant.create({
    roomId,
    userId,
    role: user.role || role,
    isOnline: false,
  });

  await Room.updateOne(
    { _id: roomId },
    {
      $inc: { "audit.participantCount": 1 },
      $set: { "audit.lastAccessAt": new Date() },
    }
  );

  await Notification.create({
    userId,
    senderId: currentUserId,
    type: "communication.addParticipant",
    title: "Вы добавлены в комнату общения",
    message: `Вас пригласили в чат: ${room.title || "Без названия"}`,
    link: `/chat/${room._id}`,
    icon: "user-plus",
    priority: "normal",
  });

  return { participant };
};

/**
 * 3️⃣ Отправка сообщения в комнату
 */
export const sendMessage = async ({
  senderId,
  roomId,
  type,
  content,
  fileUrl,
  replyTo,
}) => {
  const room = await Room.findById(roomId);
  if (!room) throw new Error("Комната не найдена");

  const participant = await Participant.findOne({ roomId, userId: senderId });
  if (!participant) throw new Error("Нет доступа к этой комнате");

  const message = await Message.create({
    roomId,
    senderId,
    type,
    content,
    fileUrl,
    replyTo,
  });

  await Participant.updateOne(
    { roomId, userId: senderId },
    { $inc: { totalMessagesSent: 1 } }
  );

  const fullMessage = await Message.findById(message._id)
    .populate("senderId", "firstNameEncrypted lastNameEncrypted avatar role")
    .lean();

  if (fullMessage.senderId) {
    fullMessage.senderId.firstName = decrypt(
      fullMessage.senderId.firstNameEncrypted
    );
    fullMessage.senderId.lastName = decrypt(
      fullMessage.senderId.lastNameEncrypted
    );
    delete fullMessage.senderId.firstNameEncrypted;
    delete fullMessage.senderId.lastNameEncrypted;
  }

  return { message: fullMessage };
};

/**
 * 4️⃣ Получение сообщений комнаты
 */
export const getMessages = async ({
  userId,
  roomId,
  page = 1,
  limit = 30,
  search = "",
  type,
  sort = "desc",
}) => {
  const room = await Room.findById(roomId);
  if (!room) throw new Error("Комната не найдена");

  const participant = await Participant.findOne({ roomId, userId });
  if (!participant) throw new Error("Нет доступа к истории комнаты");

  const filter = { roomId };
  if (type) filter.type = type;
  if (search) filter.content = { $regex: search, $options: "i" };

  const skip = (page - 1) * limit;
  const sortOrder = sort === "asc" ? 1 : -1;

  const messages = await Message.find(filter)
    .sort({ createdAt: sortOrder })
    .skip(skip)
    .limit(Number(limit))
    .populate("senderId", "firstNameEncrypted lastNameEncrypted avatar role")
    .lean();

  for (const msg of messages) {
    if (msg.senderId) {
      msg.senderId.firstName = decrypt(msg.senderId.firstNameEncrypted);
      msg.senderId.lastName = decrypt(msg.senderId.lastNameEncrypted);
      delete msg.senderId.firstNameEncrypted;
      delete msg.senderId.lastNameEncrypted;
    }
  }

  const total = await Message.countDocuments(filter);

  return {
    messages,
    pagination: {
      total,
      page: Number(page),
      totalPages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
    },
  };
};
