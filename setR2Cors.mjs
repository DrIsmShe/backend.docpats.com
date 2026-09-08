// Разрешить браузеру класть файлы прямо в хранилище (CORS для R2).
//
// ЗАЧЕМ. Ролик загружается подписанной ссылкой: браузер шлёт файл прямо в
// R2, минуя наш сервер. Для этого бакет должен разрешать запись с нашего
// домена. Пока не разрешает — preflight отвечает 403, браузер не начинает
// отправку, и человек видит «Загрузка не удалась» при исправных сервере и
// хранилище. Запасной путь (через сервер) работает, но гонит весь трафик
// роликов через нас.
//
// ПОЧЕМУ ОТДЕЛЬНЫЙ ТОКЕН. Ключ приложения умеет читать и писать ОБЪЕКТЫ, но
// не настройки бакета: GetBucketCors отвечает AccessDenied. Настройка
// бакета — административное действие, и правильно, что рабочий ключ его не
// может: утечка такого ключа иначе означала бы и смену правил доступа.
//
// ЧТО НУЖНО СДЕЛАТЬ ОДИН РАЗ:
//   1. Cloudflare → Manage Account → API Tokens → Create Token
//   2. Шаблон Custom → Permissions: Account · Workers R2 Storage · Edit
//   3. Скопировать токен и положить в .env сервера:
//        CLOUDFLARE_API_TOKEN=...
//   4. node setR2Cors.mjs
//
// Токен нужен ровно один раз: после установки политики его можно отозвать.
//
// ЗАПУСК: node setR2Cors.mjs [--show]
//   --show  только показать текущую политику, ничего не менять

import dotenv from "dotenv";

dotenv.config();

const ТОКЕН = process.env.CLOUDFLARE_API_TOKEN || "";
const АККАУНТ = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || "";
const БАКЕТ = process.env.R2_BUCKET || "";

/* Кто может писать в хранилище из браузера.
   Локальная разработка включена намеренно: без неё загрузка работает на
   проде и молча отказывает на машине разработчика — худший вид разницы
   между средами. */
const ОТКУДА = [
  "https://docpats.com",
  "https://www.docpats.com",
  "http://localhost:3000",
];

/* Формат — не S3, а собственный у Cloudflare: allowed внутри правила,
   ключи со строчной буквы. S3-стиль (AllowedOrigins) отвергается с
   «The JSON you provided was not well formed». */
const ПОЛИТИКА = [
  {
    // Чтение — всем: ролики и обложки показываются на открытой витрине
    // и во встроенном плеере на чужих сайтах. Это было и до нас.
    allowed: {
      origins: ["*"],
      methods: ["GET", "HEAD"],
      headers: ["*"],
    },
    exposeHeaders: ["*"],
    maxAgeSeconds: 86400,
  },
  {
    // Запись — только с наших страниц. Именно этого правила не было,
    // и браузер получал 403 на preflight перед PUT.
    allowed: {
      origins: ОТКУДА,
      methods: ["PUT", "GET", "HEAD"],
      // Content-Type обязателен: ссылка подписана под конкретный тип,
      // и браузер шлёт его заголовком.
      headers: ["content-type"],
    },
    // ETag — чтобы клиент мог убедиться, что файл долетел целиком.
    exposeHeaders: ["ETag"],
    maxAgeSeconds: 3600,
  },
];

const адрес = `https://api.cloudflare.com/client/v4/accounts/${АККАУНТ}/r2/buckets/${БАКЕТ}/cors`;

async function запрос(метод, тело) {
  const ответ = await fetch(адрес, {
    method: метод,
    headers: {
      authorization: `Bearer ${ТОКЕН}`,
      "content-type": "application/json",
    },
    ...(тело ? { body: JSON.stringify(тело) } : {}),
  });

  const текст = await ответ.text();
  let разобрано = null;
  try {
    разобрано = JSON.parse(текст);
  } catch {
    /* Cloudflare отвечает JSON всегда, но полагаться на это не будем. */
  }

  return { ok: ответ.ok, status: ответ.status, тело: разобрано, текст };
}

async function main() {
  if (!АККАУНТ || !БАКЕТ) {
    console.error("Не задано R2_ACCOUNT_ID или R2_BUCKET в .env");
    process.exit(1);
  }

  if (!ТОКЕН) {
    console.error(
      "Не задан CLOUDFLARE_API_TOKEN.\n" +
        "Создайте токен: Cloudflare → API Tokens → Custom →\n" +
        "  Account · Workers R2 Storage · Edit\n" +
        "и положите его в .env строкой CLOUDFLARE_API_TOKEN=...",
    );
    process.exit(1);
  }

  console.log(`бакет: ${БАКЕТ}`);

  const показать = process.argv.includes("--show");

  const текущая = await запрос("GET");
  if (текущая.ok) {
    const правила = текущая.тело?.result?.rules || текущая.тело?.result || [];
    console.log(
      "текущая политика:",
      Array.isArray(правила) && правила.length
        ? JSON.stringify(правила, null, 1)
        : "пусто",
    );
  } else {
    console.log(`текущую политику прочитать не удалось (${текущая.status})`);
  }

  if (показать) return;

  const итог = await запрос("PUT", { rules: ПОЛИТИКА });
  if (!итог.ok) {
    console.error(`не удалось установить (${итог.status}):`, итог.текст.slice(0, 400));
    process.exit(1);
  }

  console.log("политика установлена. Разрешено писать с:");
  for (const о of ОТКУДА) console.log("  " + о);
  console.log(
    "\nПроверьте загрузку ролика: она должна пойти прямо в хранилище,\n" +
      "минуя сервер. Токен больше не нужен — его можно отозвать.",
  );
}

main().catch((err) => {
  console.error("ОШИБКА:", err.message);
  process.exit(1);
});
