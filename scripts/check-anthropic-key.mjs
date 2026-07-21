// server/scripts/check-anthropic-key.mjs
//
// Диагностика ключа Anthropic. Проверяет ключ НАПРЯМУЮ, минуя приложение,
// поэтому отвечает на главный вопрос: проблема в ключе или в коде вокруг него.
//
// Использование (из папки server/):
//   node scripts/check-anthropic-key.mjs
//
// Скрипт НЕ печатает ключ целиком — только длину, префикс и хвост, чтобы
// вывод можно было безопасно скопировать в переписку.

import dotenv from "dotenv";

dotenv.config();

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";

function mask(value) {
  if (!value) return "(пусто)";
  if (value.length <= 16) return `${value.slice(0, 4)}…${value.slice(-2)}`;
  return `${value.slice(0, 12)}…${value.slice(-4)}`;
}

console.log("\n─── Что задано в окружении ───\n");

const rawKey = process.env.ANTHROPIC_API_KEY;
const rawToken = process.env.ANTHROPIC_AUTH_TOKEN;
const baseUrl = process.env.ANTHROPIC_BASE_URL;
const model = process.env.EDUCATION_EXTRACTOR_MODEL || "claude-opus-4-8";
const extractor = process.env.EDUCATION_EXTRACTOR || "manual";

console.log(`ANTHROPIC_API_KEY     : ${rawKey ? mask(rawKey) : `${RED}не задан${RESET}`}`);
console.log(`ANTHROPIC_AUTH_TOKEN  : ${rawToken ? mask(rawToken) : "не задан"}`);
console.log(`ANTHROPIC_BASE_URL    : ${baseUrl || "не задан (стандартный)"}`);
console.log(`EDUCATION_EXTRACTOR   : ${extractor}`);
console.log(`EDUCATION_EXTRACTOR_MODEL: ${model}`);

if (!rawKey && !rawToken) {
  console.log(
    `\n${RED}Ключа нет вовсе.${RESET} Добавьте в .env строку:\n  ANTHROPIC_API_KEY=sk-ant-api03-...\n`,
  );
  process.exit(1);
}

console.log("\n─── Проверка формы ключа ───\n");

const problems = [];

if (rawKey && rawKey !== rawKey.trim()) {
  problems.push(
    "в значении есть пробелы или перевод строки по краям — уберите их в .env",
  );
}
if (rawKey && /^["']|["']$/.test(rawKey.trim())) {
  problems.push(
    'значение обёрнуто в кавычки — в .env они не нужны: пишите ANTHROPIC_API_KEY=sk-ant-... без кавычек',
  );
}

const cleanKey = (rawKey || "").trim().replace(/^["']|["']$/g, "");

if (cleanKey && !cleanKey.startsWith("sk-ant-")) {
  problems.push(
    `ключ не начинается с «sk-ant-» (сейчас: «${cleanKey.slice(0, 8)}…»). Это не ключ Anthropic API`,
  );
}
if (cleanKey.startsWith("sk-ant-oat")) {
  problems.push(
    "это OAuth-токен Claude Code (sk-ant-oat…), а не ключ API. Для сервера нужен ключ из console.anthropic.com → API Keys",
  );
}
if (rawKey && rawToken) {
  problems.push(
    "заданы ОБА: ANTHROPIC_API_KEY и ANTHROPIC_AUTH_TOKEN. SDK отправит оба заголовка, и API отклонит запрос с 401 — уберите один",
  );
}
if (cleanKey && cleanKey.length < 90) {
  problems.push(
    `подозрительно короткий ключ (${cleanKey.length} символов, обычно 100–110) — похоже, скопирован не целиком`,
  );
}

// Копирование ключа с веб-страницы иногда протаскивает неразрывный пробел
// или zero-width символ. Глазами такое не увидеть, а ключ уже сломан.
const invisible = [...cleanKey].filter((ch) => {
  const code = ch.codePointAt(0);
  return (
    code < 33 || code === 0xa0 || (code >= 0x200b && code <= 0x200f) || code === 0xfeff
  );
});
if (invisible.length) {
  problems.push(
    `внутри ключа невидимые символы (${invisible
      .map((c) => "U+" + c.codePointAt(0).toString(16))
      .join(", ")}) — скопируйте ключ заново, через простой текстовый редактор`,
  );
}
if (cleanKey && !/^[A-Za-z0-9_-]+$/.test(cleanKey)) {
  problems.push("в ключе есть посторонние символы — допустимы только буквы, цифры, «-» и «_»");
}

if (cleanKey) {
  console.log(`${DIM}длина: ${cleanKey.length} символов${RESET}`);
}

if (problems.length === 0) {
  console.log(`${GREEN}Форма ключа выглядит правильно.${RESET}`);
} else {
  for (const p of problems) console.log(`${YELLOW}!${RESET} ${p}`);
}

console.log("\n─── Живой запрос к API ───\n");

try {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: cleanKey, authToken: null });

  const response = await client.messages.create({
    model,
    max_tokens: 16,
    messages: [{ role: "user", content: "ping" }],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  console.log(`${GREEN}✅ Ключ рабочий.${RESET}`);
  console.log(`${DIM}модель ответила: ${text.trim()}${RESET}`);
  console.log(`${DIM}модель: ${response.model}${RESET}`);
  console.log(
    `\nЕсли загрузка файлов всё равно не работает — проверьте, что в .env стоит EDUCATION_EXTRACTOR=claude (сейчас: ${extractor}).\n`,
  );
} catch (err) {
  const status = err?.status ?? null;
  console.log(`${RED}❌ Запрос отклонён.${RESET} HTTP ${status ?? "—"}`);
  console.log(`${DIM}${err?.message ?? err}${RESET}\n`);

  if (status === 401) {
    console.log("Что это значит: ключ дошёл до Anthropic и был отвергнут.");
    console.log(
      "Запрос сделан напрямую из этого скрипта, поэтому код приложения тут ни при чём.",
    );

    if (problems.length === 0) {
      // Форма ключа безупречна, а API его не принимает — значит вопрос
      // не к строке в .env, а к самому ключу в аккаунте.
      console.log(
        "\nФорма ключа правильная, значит дело в самом ключе на стороне Anthropic:",
      );
      console.log("  • ключ удалён или перевыпущен — в .env лежит старый;");
      console.log("  • ключ принадлежит удалённой или отключённой организации;");
      console.log("  • у аккаунта нет доступа к API.");
      console.log(
        "\nЧто делать: зайдите на console.anthropic.com → Settings → API Keys,",
      );
      console.log(
        "убедитесь, что ключ есть в списке и активен. Проще всего — создать новый",
      );
      console.log("ключ, вставить его в .env и перезапустить сервер.");
      console.log(
        "\nВажно: подписка Claude Pro/Max НЕ даёт доступ к API — это отдельный",
      );
      console.log("продукт с отдельным балансом в console.anthropic.com.");
    } else {
      console.log("\nСначала устраните замечания к форме ключа, перечисленные выше.");
    }

    console.log(
      "\nЗапуск с localhost на это НЕ влияет: API не проверяет, откуда пришёл запрос.",
    );
  } else if (status === 400 && /credit|balance/i.test(err?.message ?? "")) {
    console.log("Ключ верный, но на балансе нет средств — пополните счёт в консоли Anthropic.");
  } else if (status === 404) {
    console.log(`Модель «${model}» недоступна. Проверьте EDUCATION_EXTRACTOR_MODEL в .env.`);
  } else if (!status) {
    console.log("Похоже на сетевую проблему: сервер не смог достучаться до api.anthropic.com.");
    console.log("Проверьте интернет, прокси и файрвол.");
  }
  console.log("");
  process.exit(1);
}
