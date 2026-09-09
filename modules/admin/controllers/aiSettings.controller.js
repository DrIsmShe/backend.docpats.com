// server/modules/admin/controllers/aiSettings.controller.js
//
// Какой моделью работает платформа — чтение и правка из админки.
//
// ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ ЭКРАН, А НЕ СТРОКА В .env. Переменная окружения
// меняется выкладкой и рестартом; пока кто-то дойдёт до сервера, врачи уже
// читают непереведённые статьи. Здесь смена — нажатие, и она действует на
// следующем задании очереди.
//
// КЛЮЧИ API СЮДА НЕ ПОПАДАЮТ. Админка показывает, ЧТО выбрано, а не чем мы
// платим: ключ, попавший в базу, попадает и в резервную копию, и в выгрузку.

import { asyncHandler } from "../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../common/utils/errors.js";
import {
  настройкиИИ,
  сохранитьНастройкиИИ,
  МОДЕЛИ_ПО_УМОЛЧАНИЮ,
  ПРОВАЙДЕРЫ,
  НАЗНАЧЕНИЯ,
  ТОЛЬКО_OPENAI,
} from "../../../common/ai/provider.js";

/* Где что применяется. Список нужен не коду, а человеку: без него экран
   «провайдер для summary» ничего не говорит о том, что сломается. */
const ГДЕ_ПРИМЕНЯЕТСЯ = {
  translation: "Перевод статей, субтитров и разделов витрины на пять языков",
  chat: "Перевод сообщений в чате между врачом и пациентом",
  summary: "Выжимки, аннотации и краткие пересказы",
  consultation: "ИИ-консультации, разборы и второе мнение",
  speech: "Расшифровка речи: надиктовка и субтитры к роликам",
  image: "Генерация изображений для симуляций",
};

/** Текущее состояние плюс всё, что нужно нарисовать форму. */
export const getAiSettings = asyncHandler(async (_req, res) => {
  const текущее = await настройкиИИ({ fresh: true });

  res.json({
    provider: текущее.provider,
    tasks: текущее.tasks,
    updatedAt: текущее.updatedAt,
    lastChange: текущее.lastChange,
    catalog: {
      providers: ПРОВАЙДЕРЫ,
      tasks: НАЗНАЧЕНИЯ.map((н) => ({
        key: н,
        title: ГДЕ_ПРИМЕНЯЕТСЯ[н] || н,
        // Назначения, которых у Anthropic нет вовсе: выбор там фиктивный, и
        // интерфейс обязан сказать это заранее, а не после сохранения.
        openaiOnly: ТОЛЬКО_OPENAI.includes(н),
        defaults: Object.fromEntries(
          ПРОВАЙДЕРЫ.map((п) => [п, МОДЕЛИ_ПО_УМОЛЧАНИЮ[п]?.[н] || ""]),
        ),
      })),
    },
  });
});

/** Правка. Назначения меняются по одному — см. сервис. */
export const patchAiSettings = asyncHandler(async (req, res) => {
  const { provider, tasks } = req.body || {};

  if (!provider && (!tasks || Object.keys(tasks).length === 0)) {
    throw new ValidationError("Нечего менять: не переданы ни провайдер, ни назначения");
  }

  try {
    const итог = await сохранитьНастройкиИИ({
      adminId: req.session?.userId,
      provider,
      tasks: tasks || {},
    });
    res.json({ ok: true, ...итог });
  } catch (err) {
    throw new ValidationError(err.message);
  }
});
