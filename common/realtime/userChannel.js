// server/common/realtime/userChannel.js
//
// Личный realtime-канал пользователя.
//
// ЗАЧЕМ ЭТОТ ФАЙЛ ПОЯВИЛСЯ
// По коду было рассыпано 35 обращений вида
//     if (global.io) global.io.to(String(userId)).emit("new_notification", …)
// в семи файлах — и НИ ОДНОГО присваивания `global.io`. Проверяется просто:
// единственное `global.io =` во всём дереве лежит внутри клиентской сборки
// socket.io в node_modules. То есть условие всегда ложно, и все эти
// «уведомления в реальном времени» никуда не уходили: колокольчик оживал
// только при перезагрузке страницы.
//
// Вторая ошибка тех же строк — адрес. Клиент подключается к НЕЙМСПЕЙСУ
// /communication и входит в комнату `user:<id>` (socket.gateway.js). Корневой
// неймспейс, куда целился global.io, клиент не открывает вовсе, а комнаты с
// голым id там никто не занимает. Даже с присвоенным global.io события
// уходили бы в пустоту.
//
// Поэтому один модуль с одним адресом: `/communication` + `user:<id>`. Тот
// же адрес, по которому уже работают звонки и сообщения, — единственный
// проверенный на живых пользователях.
//
// Использование:
//   index.js               setRealtimeNamespace(nsp)   — один раз при старте
//   любой сервис/контроллер emitNotification(userId, notificationDoc)

let nspRef = null;

/** Вызывается один раз при старте: io.of("/communication"). */
export function setRealtimeNamespace(nsp) {
  nspRef = nsp || null;
}

export function isRealtimeReady() {
  return Boolean(nspRef);
}

/**
 * Отправить событие в личную комнату пользователя.
 * Никогда не бросает: realtime — дополнение к записи в БД, а не замена ей.
 * @returns {boolean} дошло ли до сокет-слоя (не гарантия доставки клиенту)
 */
export function emitToUser(userId, event, payload) {
  if (!nspRef || !userId || !event) return false;
  try {
    nspRef.to(`user:${String(userId)}`).emit(event, payload);
    return true;
  } catch (err) {
    console.error("[realtime] emitToUser failed:", err?.message);
    return false;
  }
}

/**
 * Уведомление в колокольчик. Форма payload — та же, что уже слушает клиент
 * (socket.js → window CustomEvent "new_notification" → NotificationBell).
 *
 * @param {string|ObjectId} userId
 * @param {object} n  документ Notification или совместимый объект
 */
export function emitNotification(userId, n = {}) {
  if (!n) return false;
  return emitToUser(userId, "new_notification", {
    _id: n._id ? String(n._id) : undefined,
    title: n.title,
    message: n.message,
    link: n.link || null,
    type: n.type || "system_message",
    icon: n.icon || "bell",
    priority: n.priority || "normal",
    createdAt: n.createdAt || new Date(),
  });
}

export default {
  setRealtimeNamespace,
  isRealtimeReady,
  emitToUser,
  emitNotification,
};
