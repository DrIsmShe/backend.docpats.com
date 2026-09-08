// server/modules/video/services/videoQuota.service.js
//
// Расход на ролики: минуты рендера и объём хранения.
//
// ПОЧЕМУ ШТУК МАЛО. Тариф считает `videraFilms` — сколько фильмов разрешено.
// Ролик на двадцать секунд и на три минуты стоят по-разному: рендер, синтез
// речи и хранение линейны по длительности, а не по числу файлов. Счёт в
// штуках означает, что бесплатный пользователь с тремя трёхминутными
// роликами обходится дороже платного с десятью двадцатисекундными.
//
// ПОЧЕМУ ХРАНЕНИЕ СЧИТАЕТСЯ ОТДЕЛЬНО ОТ РЕНДЕРА. Рендер — разовый расход в
// момент создания, хранение — ежемесячный и накопительный. Человек может не
// снять ни одного нового ролика за месяц и всё равно занимать гигабайты.
// Раздача при этом бесплатна: R2 не берёт за исходящий трафик — из-за этого
// и выбран он, а не S3.
//
// ОКНО СКОЛЬЗЯЩЕЕ, а не календарный месяц: так же считается квота
// видеозвонков (common/video/videoQuota.service.js), и два разных правила в
// одном продукте были бы источником вечных вопросов «почему у меня уже
// кончилось».

import mongoose from "mongoose";
import Video from "../models/video.model.js";
import {
  resolveEffectivePlan,
  videraRenderMinutesAllowed,
  videraStorageAllowed,
} from "../../../common/config/aiPlanLimits.js";

/** Длина окна расчёта — как у квоты минут видеосвязи. */
const ОКНО_ДНЕЙ = 30;

const БАЙТ_В_ГБ = 1024 ** 3;

/**
 * Себестоимость минуты готового ролика, в долларах.
 *
 * Оценка, а не замер: пока роликов нет, считать нечего. Держим её здесь, а
 * не в отчётах, чтобы уточнять в одном месте — как только пойдут реальные
 * рендеры, сюда придёт факт.
 */
export const ЦЕНА_МИНУТЫ_РЕНДЕРА = 0.12;
/** Хранение гигабайта в месяц (R2). Раздача бесплатна и в расчёт не входит. */
export const ЦЕНА_ГБ_ХРАНЕНИЯ = 0.015;

function окно() {
  return new Date(Date.now() - ОКНО_ДНЕЙ * 86400000);
}

/**
 * Сколько минут отрендерено за окно и сколько занято хранилища.
 *
 * Считаем по каталогу, а не по журналу заданий: очередь чистится, а записи
 * остаются — и именно они отвечают на вопрос «за что я плачу».
 */
export async function videoUsage({ ownerType, ownerId }) {
  if (!mongoose.isValidObjectId(ownerId)) {
    return { renderedMinutes: 0, storageGb: 0, videos: 0 };
  }

  const [свежие, всё] = await Promise.all([
    Video.aggregate([
      {
        $match: {
          ownerType,
          ownerId: new mongoose.Types.ObjectId(String(ownerId)),
          createdAt: { $gte: окно() },
          status: { $in: ["processing", "ready"] },
        },
      },
      { $group: { _id: null, seconds: { $sum: "$media.durationSec" } } },
    ]),
    Video.aggregate([
      {
        $match: {
          ownerType,
          ownerId: new mongoose.Types.ObjectId(String(ownerId)),
        },
      },
      {
        $group: {
          _id: null,
          bytes: { $sum: "$media.sizeBytes" },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  return {
    renderedMinutes: Math.round(((свежие[0]?.seconds || 0) / 60) * 10) / 10,
    storageGb: Math.round(((всё[0]?.bytes || 0) / БАЙТ_В_ГБ) * 1000) / 1000,
    videos: всё[0]?.count || 0,
  };
}

/**
 * Остаток по тарифу.
 *
 * Возвращает -1 там, где предела нет, и настоящий остаток там, где он есть.
 * Ноль означает запрет, а не безлимит — этим квота роликов отличается от
 * остальных квот проекта, и различие намеренное: тариф без права снимать
 * ролики должен уметь это выразить.
 */
export async function videoQuota({ user, ownerType = "user", ownerId = null }) {
  const plan = user ? resolveEffectivePlan(user) : "clinic";
  // ТРИ ЗНАЧЕНИЯ, А НЕ ДВА: -1 — без предела, 0 — запрещено, больше нуля —
  // предел. Общий getLimit для этого не годится: он трактует и ноль, и
  // отсутствие поля как «предел не применять», и гость с нулём минут
  // получил бы безлимитный рендер вместо запрета. Здесь смысл нуля
  // противоположный, поэтому пределы читаются своими хелперами.
  const пределМинут = videraRenderMinutesAllowed(plan);
  const пределГб = videraStorageAllowed(plan);

  const расход = await videoUsage({
    ownerType,
    ownerId: ownerId || user?._id,
  });

  // Докупленные минуты живут на пользователе и складываются с тарифом:
  // человек, выбравший пакет, не должен ждать следующего месяца.
  const докуплено = Number(user?.videoRenderMinutesAddon) || 0;
  // Докупленные минуты поднимают и нулевой предел: пакет — это разрешение,
  // а не прибавка к уже имеющемуся разрешению.
  const всегоМинут = пределМинут === -1 ? -1 : пределМинут + докуплено;

  return {
    plan,
    renderedMinutes: расход.renderedMinutes,
    renderLimit: всегоМинут,
    renderLeft:
      всегоМинут === -1 ? -1 : Math.max(0, всегоМинут - расход.renderedMinutes),
    storageGb: расход.storageGb,
    storageLimit: пределГб,
    storageLeft: пределГб === -1 ? -1 : Math.max(0, пределГб - расход.storageGb),
    videos: расход.videos,
  };
}

/**
 * Хватит ли квоты на ролик такой длительности.
 *
 * Проверяется ДО постановки задания: отказать после рендера — значит
 * заплатить за него и всё равно не дать результат.
 */
export async function canRender({ user, ownerType = "user", ownerId = null, durationSec }) {
  const квота = await videoQuota({ user, ownerType, ownerId });
  if (квота.renderLimit === -1) return { allowed: true, quota: квота };
  if (квота.renderLimit === 0) {
    return {
      allowed: false,
      quota: квота,
      reason: "На этом тарифе сборка роликов недоступна",
    };
  }

  const нужно = (Number(durationSec) || 0) / 60;
  const allowed = квота.renderLeft >= нужно;
  return {
    allowed,
    quota: квота,
    reason: allowed
      ? null
      : `Не хватает минут рендера: нужно ${нужно.toFixed(1)}, осталось ${квота.renderLeft.toFixed(1)}`,
  };
}

/**
 * Во что обошлись ролики — для отчёта.
 *
 * Цифры считаются по тем же ставкам, что и в тарифной модели, чтобы
 * «выручка ≥ 3 × расход» проверялась одними и теми же числами.
 */
export async function videoCost({ ownerType, ownerId }) {
  const { renderedMinutes, storageGb, videos } = await videoUsage({ ownerType, ownerId });
  const рендер = renderedMinutes * ЦЕНА_МИНУТЫ_РЕНДЕРА;
  const хранение = storageGb * ЦЕНА_ГБ_ХРАНЕНИЯ;
  return {
    renderedMinutes,
    storageGb,
    videos,
    renderCost: Math.round(рендер * 100) / 100,
    storageCost: Math.round(хранение * 100) / 100,
    totalCost: Math.round((рендер + хранение) * 100) / 100,
  };
}

/**
 * Начислить минуты — покупка пакета или выдача администратором.
 *
 * Минуты складываются, а не заменяются: человек, купивший два пакета подряд,
 * должен получить сумму, а не последний из них.
 *
 * Запись в реестр транзакций обязательна и по той же причине, что у выдачи
 * тарифов (modules/payments/controllers/grant.controller.js): начисление без
 * следа в базе через полгода читается как «откуда у него эти минуты», и
 * первый же финансовый отчёт разъезжается. Сбой записи в реестр не
 * откатывает начисление — человек уже заплатил, отнимать оплаченное хуже,
 * чем иметь пробел в отчёте, — но пишется предупреждение.
 */
export async function grantMinutes({ userId, minutes, reason, paid = 0, grantedBy = null }) {
  const сколько = Math.max(0, Math.round(Number(minutes) || 0));
  if (!сколько) throw new Error("Нечего начислять");

  const User = (await import("../../../common/models/Auth/users.js")).default;
  const user = await User.findByIdAndUpdate(
    userId,
    { $inc: { videoRenderMinutesAddon: сколько } },
    { new: true },
  ).select("videoRenderMinutesAddon");
  if (!user) throw new Error("Пользователь не найден");

  try {
    const PaymentTransaction = (
      await import("../../payments/models/paymentTransaction.js")
    ).default;
    await PaymentTransaction.create({
      userId,
      // kind в модели знает только про подписки и приёмы; минуты — третий
      // случай, и до расширения перечисления он ложится в подписку с
      // пометкой в meta. Врать нельзя, но и молчать о покупке хуже:
      // отчёт всё равно должен её видеть.
      kind: "subscription",
      provider: "local",
      amount: paid,
      currency: "USD",
      // Статус из словаря модели: "paid", а не "succeeded" — иначе запись
      // не проходит валидацию и покупка теряется без следа.
      status: "paid",
      paidAt: new Date(),
      meta: {
        purpose: "video_minutes",
        minutes: сколько,
        reason: String(reason || "").slice(0, 300),
        grantedBy: grantedBy ? String(grantedBy) : null,
      },
    });
  } catch (err) {
    console.warn("[video] начисление минут не попало в реестр:", err?.message);
  }

  return { minutesAdded: сколько, minutesTotal: user.videoRenderMinutesAddon };
}

export default { videoUsage, videoQuota, canRender, videoCost, grantMinutes };
