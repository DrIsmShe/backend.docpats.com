// common/realtime/socketAdapter.js
//
// Сшивка нескольких процессов Socket.IO через Redis.
//
// Зачем. И fetchSockets(), и broadcast работают ТОЛЬКО внутри своего
// процесса. Пока сервер запущен в одном экземпляре, этого не видно. Со
// второго (pm2 в режиме cluster, вторая машина за nginx) начинается
// тихая поломка: presence:get не находит сокеты собеседника,
// подключённого к соседнему процессу, и честно отвечает online:false —
// кнопки звонка гаснут у человека, который на самом деле сидит на сайте.
// Сообщения и user:online / user:offline между такими собеседниками
// тоже перестают доходить.
//
// Почему по флагу, а не всегда. Там, где процесс один, адаптер не нужен,
// а лишняя зависимость realtime от Redis — это лишний способ уронить
// чат. Включается явно: SOCKET_REDIS_ADAPTER=on. Без флага поведение
// ровно прежнее.
//
// Вызывать ДО создания namespace.
//
// Импорт адаптера — динамический, и это не стиль, а защита деплоя. На
// VPS обновление идёт через git pull; статический import пакета, для
// которого ещё не сделали npm install, в ESM падает на загрузке модуля и
// роняет ВЕСЬ процесс — при том что флаг может быть выключен и адаптер
// не нужен вовсе. Так отсутствие пакета остаётся проблемой только того,
// кто флаг включил, и то в виде записи в логе, а не падения.

import { redis } from "../config/redis.js";

export async function attachRedisAdapter(io) {
  if (process.env.SOCKET_REDIS_ADAPTER !== "on") return false;

  let createAdapter;
  try {
    ({ createAdapter } = await import("@socket.io/redis-adapter"));
  } catch (err) {
    console.error(
      "❌ SOCKET_REDIS_ADAPTER=on, но пакет @socket.io/redis-adapter не установлен",
      "— запустите npm install. Работаем без адаптера:",
      "presence и рассылки видят только свой процесс.",
      err.message,
    );
    return false;
  }

  // duplicate(), а не общий клиент: соединение, ушедшее в подписку, не
  // может выполнять обычные команды, а publish-клиенту они нужны.
  const pubClient = redis.duplicate();
  const subClient = redis.duplicate();

  // Без обработчика ошибка соединения ioredis всплывает как unhandled
  // 'error' и роняет процесс целиком.
  for (const [name, client] of [
    ["pub", pubClient],
    ["sub", subClient],
  ]) {
    client.on("error", (err) => {
      console.error(`❌ Socket.IO Redis-адаптер (${name}):`, err.message);
    });
  }

  io.adapter(createAdapter(pubClient, subClient));
  console.log("✅ Socket.IO: Redis-адаптер включён (presence виден всем процессам)");
  return true;
}

export default attachRedisAdapter;
