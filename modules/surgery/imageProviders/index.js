// modules/surgery/imageProviders/index.js
//
// Выбор поставщика генерации «после» по фотографии.
//
// Зачем развилка. Провайдеры отличаются не ценой, а поведением: fal
// (FLUX Fill) заточен под инпейнт и лучше сохраняет кадр вокруг маски;
// OpenAI не требует нового вендора и нового договора, но отдаёт свой
// размер и не понимает негативного промта. Сравнивать их по описанию
// бессмысленно — нужно прогнать один снимок через обоих и посмотреть.
// Отсюда переключатель, а не «выбрали один навсегда».
//
//   IMAGE_PROVIDER=fal      (по умолчанию — прежнее поведение)
//   IMAGE_PROVIDER=openai
//
// Контракт провайдера:
//   run({ imageBuffer, maskBuffer, prompt, negativePrompt, numOutputs })
//     → { requestId, images: Buffer[], ext }
//
// Буферы, а не ссылки: fal отдаёт URL, OpenAI — base64, и воркер не
// должен знать, у кого что. Файловые операции остаются в воркере.
//
// ВАЖНО про данные. Оба провайдера — внешние сервисы, и фотография лица
// пациента уходит к ним. Это идентифицируемые медицинские данные: нужен
// либо BAA с поставщиком, либо явное согласие пациента на передачу.
// Шифрование и аудит внутри платформы этот факт не отменяют.

import { falProvider } from "./fal.provider.js";
import { openaiProvider } from "./openai.provider.js";

const PROVIDERS = {
  fal: falProvider,
  openai: openaiProvider,
};

export function getImageProvider() {
  const name = (process.env.IMAGE_PROVIDER || "fal").trim().toLowerCase();
  const provider = PROVIDERS[name];

  if (!provider) {
    throw new Error(
      `IMAGE_PROVIDER="${name}" неизвестен. Доступны: ${Object.keys(PROVIDERS).join(", ")}`,
    );
  }

  return provider;
}

/** Строка для лога при старте — чтобы состояние было видно сразу. */
export function describeImageProvider() {
  try {
    const p = getImageProvider();
    return p.isConfigured()
      ? `✅ провайдер изображений: ${p.name}`
      : `❌ провайдер изображений: ${p.name} — ${p.missingHint}`;
  } catch (err) {
    return `❌ провайдер изображений: ${err.message}`;
  }
}

export default getImageProvider;
