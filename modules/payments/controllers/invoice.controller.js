// server/modules/payments/controllers/invoice.controller.js
// ─────────────────────────────────────────────────────────────────────
//   Оплата по счёту — параллельный канал к онлайн-оплате.
//
//   Три действия: оставить заявку (кто угодно), посмотреть список
//   (администратор), подтвердить оплату (администратор).
//
//   Подтверждение оплаты ОБЯЗАНО проходить тем же путём, что и
//   онлайн-платёж: grantPlan + запись в реестр транзакций. Разойдись эти
//   два пути — и в базе появятся подписки, происхождение которых через
//   полгода никто не восстановит.
// ─────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";
import InvoiceRequest from "../models/invoiceRequest.js";
import PaymentTransaction from "../models/paymentTransaction.js";
import User from "../../../common/models/Auth/users.js";
import { grantPlan } from "../services/subscription.service.js";
import {
  PLAN_PRICES,
  PLAN_DISPLAY_NAMES,
} from "../../../common/config/aiPlanLimits.js";
// Берём сервис из auth, а не из admin: в admin/emailService from задан
// как SMTP_USER — это логин Brevo, а не адрес, и письма с ним молча не
// доходят. Здесь from резолвится в проверенный отправитель.
import { sendEmail } from "../../auth/services/emailService.js";
import { requisitesAsText } from "./requisites.controller.js";
import {
  createSignedToken,
  verifySignedToken,
} from "../../../common/utils/signedUrl.js";

/** Адрес фронтенда для ссылок в письмах. */
const APP_URL = process.env.FRONTEND_URL || "https://docpats.com";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Куда падают заявки. Отдельная переменная, потому что счета обычно
// смотрит не тот, кто отвечает на обращения в поддержку.
const BILLING_INBOX =
  process.env.BILLING_EMAIL || process.env.SUPPORT_EMAIL || "support@docpats.com";

/**
 * Письмо, которое НЕ должно ломать заявку.
 *
 * Заявка к этому моменту уже сохранена. Если SMTP недоступен, потерять
 * её из-за письма — худший исход: клиент считает, что попросил счёт, а в
 * базе пусто. Поэтому ошибка только пишется в лог.
 */
function sendSafe(to, subject, text) {
  return sendEmail(to, subject, text).catch((e) => {
    console.error(`invoice: письмо на ${to} не ушло — ${e.message}`);
  });
}

/**
 * Уникальные копейки к сумме — чтобы платёж опознавался в выписке.
 *
 * Берём наименьшие свободные копейки среди НЕОПЛАЧЕННЫХ заявок на ту же
 * базовую сумму. Оплаченные не мешают: они уже закрыты, и повтор их
 * «хвостика» ни с чем не спутается.
 *
 * Диапазон 01–99, ноль пропускаем: ровная сумма — это «копеек нет», а
 * нам нужен опознавательный знак. Если свободных не осталось (99
 * неоплаченных заявок на один тариф — ситуация невероятная, но код не
 * должен на ней ломаться), отдаём базовую сумму: опознание тогда идёт по
 * номеру и по кнопке «я оплатил».
 */
async function uniqueAmount(base) {
  const taken = await InvoiceRequest.find({
    status: { $ne: "paid" },
    amountExpected: { $gte: Math.floor(base), $lt: Math.floor(base) + 1 },
  })
    .select("amountExpected")
    .lean();

  const used = new Set(
    taken.map((t) => Math.round((t.amountExpected % 1) * 100)),
  );
  for (let cents = 1; cents <= 99; cents += 1) {
    if (!used.has(cents)) return Math.floor(base) + cents / 100;
  }
  return base;
}

/**
 * Короткий номер для назначения платежа.
 *
 * Не последовательный: последовательный номер выдаёт, сколько у вас
 * клиентов, любому, кто оставил две заявки. Случайный из идентификатора
 * заявки — столь же уникален и ничего не рассказывает.
 */
function makeReference(id) {
  return `DP-${String(id).slice(-6).toUpperCase()}`;
}

/** Человеческое описание заявки — общая часть обоих писем. */
function describe(doc, planName, amount) {
  const period = doc.period === "yearly" ? "год" : "месяц";
  return [
    `Тариф: ${planName}`,
    `Период: ${period}, ${doc.months} мес.`,
    `Сумма: ${amount} USD`,
  ].join("\n");
}

/**
 * POST /api/payments/invoice-request
 *
 * Открыт без авторизации намеренно: счёт просит бухгалтер или
 * администратор клиники, у которого аккаунта на платформе нет и не
 * будет. Требовать от него регистрации — терять самого дорогого клиента
 * на первом шаге.
 */
export async function createInvoiceRequest(req, res) {
  try {
    const {
      email,
      companyName,
      contactName,
      phone,
      taxId,
      country,
      planKey,
      period,
      months,
      note,
    } = req.body || {};

    const cleanEmail = String(email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(cleanEmail)) {
      return res
        .status(400)
        .json({ success: false, message: "Укажите корректный email" });
    }

    const cleanCompany = String(companyName ?? "").trim();
    if (cleanCompany.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Укажите название организации или своё имя",
      });
    }

    // Тариф сверяем со справочником: счёт на несуществующий план — это
    // либо опечатка, либо подбор, и в обоих случаях создавать заявку
    // незачем.
    if (!PLAN_PRICES[planKey]) {
      return res
        .status(400)
        .json({ success: false, message: "Неизвестный тариф" });
    }

    const cleanPeriod = period === "monthly" ? "monthly" : "yearly";
    let cleanMonths = Number.parseInt(months, 10);
    if (!Number.isInteger(cleanMonths) || cleanMonths < 1 || cleanMonths > 36) {
      cleanMonths = cleanPeriod === "yearly" ? 12 : 1;
    }

    const fields = {
      companyName: cleanCompany,
      contactName: String(contactName ?? "").trim().slice(0, 200),
      phone: String(phone ?? "").trim().slice(0, 40),
      taxId: String(taxId ?? "").trim().slice(0, 50),
      country: String(country ?? "").trim().slice(0, 80),
      note: String(note ?? "").trim().slice(0, 1000),
    };

    // ПОВТОРНАЯ ЗАЯВКА НА ТОТ ЖЕ ТАРИФ — не новая запись, а та же самая.
    //
    // Человек жмёт «Оплатить по счёту» второй раз по обычным причинам:
    // потерял письмо, не нашёл его в спаме, решил уточнить сумму. Раньше
    // это создавало вторую заявку — а с ней ВТОРУЮ уникальную сумму.
    // Три письма с суммами 19.01, 19.02 и 19.03 не оставляют плательщику
    // ни одного шанса понять, какую переводить, а администратору —
    // какую из трёх закрывать.
    //
    // Поэтому повтор возвращает ту же заявку с теми же номером и суммой
    // и просто отправляет письмо заново. Реквизиты подтянутся свежие: их
    // могли поменять с прошлого раза.
    //
    // Другой тариф или период — законно новая заявка: человек передумал,
    // и это другая сумма.
    let doc = await InvoiceRequest.findOne({
      email: cleanEmail,
      planKey,
      period: cleanPeriod,
      months: cleanMonths,
      status: { $in: ["new", "invoiced"] },
    });

    const isRepeat = Boolean(doc);
    if (doc) {
      // Контакты могли уточниться — например, дописали налоговый номер.
      Object.assign(doc, fields);
      if (req.session?.userId && !doc.userId) doc.userId = req.session.userId;
      await doc.save();
    } else {
      doc = await InvoiceRequest.create({
        email: cleanEmail,
        ...fields,
        planKey,
        period: cleanPeriod,
        months: cleanMonths,
        userId: req.session?.userId || null,
      });
    }

    // Сумму считаем и возвращаем, чтобы заявитель сразу видел, о какой
    // цифре речь, и мог сверить со счётом.
    const price = PLAN_PRICES[planKey];
    const amount =
      Math.round(
        (cleanPeriod === "yearly"
          ? price.yearly * (cleanMonths / 12)
          : price.monthly * cleanMonths) * 100,
      ) / 100;
    const planName = PLAN_DISPLAY_NAMES[planKey] || planKey;

    // Опознание платежа в выписке: номер для назначения и уникальные
    // копейки. Считаем ПОСЛЕ создания заявки — номер строится из её
    // идентификатора.
    //
    // У повторной заявки сумму НЕ пересчитываем: человек мог уже начать
    // перевод по прошлому письму, и смена копеек сделала бы его платёж
    // неопознаваемым.
    if (!doc.reference || !doc.amountExpected) {
      doc.reference = makeReference(doc._id);
      doc.amountExpected = await uniqueAmount(amount);
      await doc.save();
    }

    // Два письма, и оба обязательны.
    //
    // Заявителю — потому что ответ на экране исчезает вместе со вкладкой,
    // а обещание «счёт придёт» остаётся. Без письма человек через день не
    // помнит, отправил он форму или передумал.
    //
    // Нам — потому что счёт выписывает человек. Заявка, о которой никто не
    // узнал, эквивалентна неотправленной: ровно то, чем эта форма была до
    // сих пор.
    // Реквизиты кладём сразу в подтверждение, а не ждём выставленного
    // счёта: платить хотят в тот же час, пока решение принято. Счёт как
    // документ нужен бухгалтерии, но деньги можно отправить раньше.
    //
    // Список берётся из справочника, которым администратор управляет сам:
    // банк закрыл счёт, добавили карту в другой валюте — правится в
    // админке, без рестарта сервера.
    const requisites = await requisitesAsText().catch(() => "");

    // Ссылка «я оплатил» живёт 30 дней: счёт обычно оплачивают в течение
    // недели, но бухгалтерия может и затянуть. Вечная ссылка из письма —
    // лишний способ дёрнуть чужую заявку.
    let claimToken = "";
    try {
      claimToken = createSignedToken(
        { invoiceRequestId: String(doc._id) },
        "30d",
      );
    } catch (e) {
      // SIGNED_URL_SECRET не задан — письмо уйдёт без кнопки, но заявка
      // сохранена и канал работает.
      console.error("invoice: подпись ссылки не создана —", e.message);
    }

    sendSafe(
      doc.email,
      `DocPats — счёт на ${planName}`,
      [
        `Здравствуйте!`,
        ``,
        // Повтор называем повтором: иначе человек решит, что у него теперь
        // два счёта, и заплатит дважды или не заплатит вовсе.
        isRepeat
          ? `Отправляем реквизиты повторно — по вашей заявке от ${new Date(
              doc.createdAt,
            ).toLocaleDateString("ru-RU")}. Новый счёт не создавался: сумма и номер прежние.`
          : `Мы получили заявку на счёт от «${cleanCompany}».`,
        ``,
        `Тариф: ${planName}`,
        `Период: ${doc.period === "yearly" ? "год" : "месяц"}, ${doc.months} мес.`,
        ``,
        // Сумма с уникальными копейками — главный способ опознать платёж.
        // В банковском приложении видно «19 $ от Ismayilov I.», и при
        // десяти врачах на одном тарифе это ничего не говорит. Копейки
        // говорят.
        `⚠ Переведите РОВНО ${doc.amountExpected.toFixed(2)} USD`,
        `Копейки в сумме — не ошибка: по ним мы находим ваш платёж среди`,
        `остальных. Округлите — и оплата потеряется среди одинаковых сумм.`,
        ``,
        // Номер показываем всегда, а не только вместе с реквизитами:
        // счёт могут прислать и отдельным письмом, а сослаться на номер
        // человеку нужно в любом случае.
        `Номер вашей заявки: ${doc.reference}`,
        `Если в переводе есть поле «назначение платежа» — укажите его там.`,
        ``,
        ...(requisites
          ? [
              requisites,
              ``,
              // Банк о поступлении нам не сообщает. Эта ссылка — способ
              // плательщика сказать «я отправил», чтобы мы знали, что
              // искать, а не просматривали выписку каждый день.
              ...(claimToken
                ? [
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                    `ПОСЛЕ ОПЛАТЫ нажмите эту ссылку — иначе мы не узнаем,`,
                    `что деньги отправлены, и подключение затянется:`,
                    ``,
                    `${APP_URL}/pay/claim/${claimToken}`,
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                    ``,
                  ]
                : []),
              `После сверки с выпиской тариф подключается в течение`,
              `рабочего дня — вы получите отдельное письмо.`,
              ``,
            ]
          : [`Счёт и реквизиты придут на этот адрес в течение рабочего дня.`, ``]),
        `Если заявку оставили по ошибке — просто ответьте на это письмо.`,
        ``,
        `— DocPats`,
      ].join("\n"),
    );

    // Администратору — только о НОВОЙ заявке. Повтор ничего не меняет ни
    // в сумме, ни в номере: письмо о нём было бы шумом, из-за которого
    // среди десяти одинаковых уведомлений теряется настоящее.
    if (!isRepeat) {
      sendSafe(
        BILLING_INBOX,
        `Заявка на счёт: ${cleanCompany} — ${planName}`,
        [
          `Организация: ${cleanCompany}`,
          `Контакт: ${String(contactName ?? "").trim() || "—"}`,
          `Email: ${doc.email}`,
          `Телефон: ${doc.phone || "—"}`,
          `Налоговый номер: ${doc.taxId || "—"}`,
          `Страна: ${doc.country || "—"}`,
          ``,
          `Тариф: ${planName}, ${doc.months} мес.`,
          `Ожидаемая сумма: ${doc.amountExpected.toFixed(2)} USD`,
          `Номер для назначения: ${doc.reference}`,
          ``,
          doc.note ? `Комментарий: ${doc.note}` : "",
          `Аккаунт на платформе: ${doc.userId ? String(doc.userId) : "не привязан"}`,
          `Идентификатор заявки: ${doc._id}`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }

    return res.status(201).json({
      success: true,
      id: doc._id,
      planName,
      months: cleanMonths,
      amount,
      currency: "USD",
      // Повтору говорим прямо, что новой заявки нет: иначе человек решит,
      // что теперь должен две суммы.
      repeat: isRepeat,
      reference: doc.reference,
      amountExpected: doc.amountExpected,
      message: isRepeat
        ? `Заявка уже была принята — отправили реквизиты повторно на ${doc.email}. ` +
          `Номер прежний: ${doc.reference}, сумма ${doc.amountExpected.toFixed(2)} USD.`
        : "Заявка принята. Счёт придёт на указанный email в течение рабочего дня.",
    });
  } catch (err) {
    console.error("createInvoiceRequest error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

/** GET /api/payments/invoice-requests?status=new — список для администратора. */
export async function listInvoiceRequests(req, res) {
  try {
    const filter = {};
    const { status } = req.query || {};
    if (status && status !== "all") filter.status = status;

    const items = await InvoiceRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    return res.status(200).json({ success: true, count: items.length, items });
  } catch (err) {
    console.error("listInvoiceRequests error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * POST /api/payments/invoice-claim/:token
 *
 * «Я оплатил» — плательщик сообщает, что отправил деньги.
 *
 * ЗАЧЕМ. Банк о поступлении не сообщает. Без этой отметки администратору
 * остаётся ежедневно просматривать выписку и гадать, есть ли там что-то
 * новое. Кнопка не подтверждает оплату — она говорит, ЧТО искать: от
 * кого, на какую сумму и когда отправлено.
 *
 * ТАРИФ ОТ НЕЁ НЕ ВКЛЮЧАЕТСЯ. Иначе это была бы кнопка «получить тариф
 * даром»: проверить заявление плательщика может только человек, сверив с
 * выпиской.
 *
 * Ссылка подписана и живёт 30 дней: адрес из письма не должен работать
 * для чужой заявки и не должен работать вечно.
 */
export async function claimInvoicePayment(req, res) {
  try {
    let payload;
    try {
      payload = verifySignedToken(req.params.token);
    } catch {
      return res.status(400).json({
        success: false,
        message: "Ссылка недействительна или устарела. Напишите нам в ответ на письмо.",
      });
    }

    const request = await InvoiceRequest.findById(payload.invoiceRequestId);
    if (!request) {
      return res
        .status(404)
        .json({ success: false, message: "Заявка не найдена" });
    }

    if (request.status === "paid") {
      return res.status(200).json({
        success: true,
        alreadyPaid: true,
        message: "Оплата уже подтверждена, тариф подключён.",
      });
    }

    const note = String(req.body?.note ?? "").trim().slice(0, 500);
    const first = !request.paymentClaimedAt;

    request.paymentClaimedAt = new Date();
    if (note) request.claimNote = note;
    await request.save();

    // Повторное нажатие письмо не задваивает: администратор уже знает.
    if (first) {
      const planName =
        PLAN_DISPLAY_NAMES[request.planKey] || request.planKey;
      sendSafe(
        BILLING_INBOX,
        `Оплачено (по словам плательщика): ${request.companyName} — ${planName}`,
        [
          `${request.companyName} сообщает, что оплатил${
            request.invoiceNumber ? ` счёт ${request.invoiceNumber}` : ""
          }.`,
          ``,
          `Тариф: ${planName}`,
          `Оплачено месяцев: ${request.months}`,
          `Email: ${request.email}`,
          note ? `Комментарий плательщика: ${note}` : "",
          ``,
          `Сверьте с выпиской и подтвердите в админке:`,
          `https://docpats.com/admin/billing`,
          ``,
          `Идентификатор заявки: ${request._id}`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }

    return res.status(200).json({
      success: true,
      message:
        "Спасибо, мы проверим поступление и подключим тариф в течение рабочего дня.",
    });
  } catch (err) {
    console.error("claimInvoicePayment error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * DELETE /api/payments/invoice-requests/:id
 *
 * Убрать заявку из списка: проверочная, дубль, передумали. Без этого
 * список зарастает и перестаёт быть рабочим инструментом — а именно
 * рабочим он и должен быть, счета выписывает человек по нему.
 *
 * ОПЛАЧЕННЫЕ НЕ УДАЛЯЮТСЯ. На них висит транзакция; удалив заявку, мы
 * оставим в реестре деньги, происхождение которых уже не восстановить.
 * Такую заявку можно только пометить отменённой — но и это не отменяет
 * платежа, поэтому решение остаётся за человеком.
 */
export async function deleteInvoiceRequest(req, res) {
  try {
    const request = await InvoiceRequest.findById(req.params.id);
    if (!request) {
      return res
        .status(404)
        .json({ success: false, message: "Заявка не найдена" });
    }

    if (request.status === "paid") {
      return res.status(409).json({
        success: false,
        message:
          "Заявка оплачена: на ней транзакция, удаление разорвало бы связь с деньгами",
        transactionId: request.transactionId,
      });
    }

    await request.deleteOne();
    console.log(
      `invoice: заявка ${request._id} (${request.companyName}) удалена админом ${req.session.userId}`,
    );

    return res.status(200).json({ success: true, id: String(request._id) });
  } catch (err) {
    console.error("deleteInvoiceRequest error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * POST /api/payments/invoice-requests/:id/paid
 * { userId?, invoiceNumber?, amount? }
 *
 * Администратор увидел поступление на счёт и подтверждает оплату.
 * Тариф выдаётся тому пользователю, что указан в заявке, либо тому,
 * кого передали явно (аккаунт мог быть заведён уже после заявки).
 */
export async function markInvoicePaid(req, res) {
  try {
    const request = await InvoiceRequest.findById(req.params.id);
    if (!request) {
      return res
        .status(404)
        .json({ success: false, message: "Заявка не найдена" });
    }
    if (request.status === "paid") {
      return res
        .status(409)
        .json({ success: false, message: "Заявка уже оплачена" });
    }

    const targetId = req.body?.userId || request.userId;
    if (!targetId || !mongoose.isValidObjectId(targetId)) {
      return res.status(400).json({
        success: false,
        message:
          "Укажите userId, кому выдать тариф: в заявке аккаунт не привязан",
      });
    }

    const user = await User.findById(targetId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "Пользователь не найден" });
    }

    let result;
    try {
      result = await grantPlan(user, {
        planKey: request.planKey,
        months: request.months,
      });
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }

    // Сумма из тела запроса, если банк зачислил не ровно прайс (курс,
    // комиссия банка, договорная скидка). Иначе считаем по справочнику.
    const price = PLAN_PRICES[request.planKey];
    const listAmount =
      request.period === "yearly"
        ? price.yearly * (request.months / 12)
        : price.monthly * request.months;
    const amount = Number.isFinite(Number(req.body?.amount))
      ? Number(req.body.amount)
      : Math.round(listAmount * 100) / 100;

    // Номер счёта проставляем ДО создания транзакции: именно он попадает
    // в providerRef и по нему потом сверяют с банковской выпиской.
    // Иначе в реестр уходил идентификатор заявки, а номер, который
    // администратор ввёл при подтверждении, терялся.
    if (req.body?.invoiceNumber) {
      request.invoiceNumber = String(req.body.invoiceNumber).trim().slice(0, 60);
    }

    const tx = await PaymentTransaction.create({
      userId: user._id,
      kind: "subscription",
      planKey: request.planKey,
      period: request.period,
      amount,
      currency: "USD",
      provider: "invoice",
      providerRef: request.invoiceNumber || String(request._id),
      status: "paid",
      paidAt: new Date(),
      meta: {
        invoiceRequestId: String(request._id),
        months: request.months,
        companyName: request.companyName,
        confirmedBy: String(req.session.userId),
      },
    });

    request.status = "paid";
    request.paidAt = new Date();
    request.processedBy = req.session.userId;
    request.transactionId = tx._id;
    await request.save();

    // Клиент заплатил и ждёт подтверждения. Без письма он узнает, что
    // тариф включён, только зайдя в кабинет и заметив разницу.
    const planName = PLAN_DISPLAY_NAMES[request.planKey] || request.planKey;
    sendSafe(
      request.email,
      `DocPats — тариф ${planName} подключён`,
      [
        `Здравствуйте!`,
        ``,
        `Оплата получена, тариф подключён.`,
        ``,
        `Тариф: ${planName}`,
        `Оплачено месяцев: ${request.months}`,
        `Сумма: ${amount} USD`,
        request.invoiceNumber ? `Счёт: ${request.invoiceNumber}` : "",
        ``,
        `— DocPats`,
      ]
        .filter(Boolean)
        .join("\n"),
    );

    return res.status(200).json({
      success: true,
      transactionId: tx._id,
      userId: String(user._id),
      planKey: request.planKey,
      months: request.months,
      amount,
      ...result,
    });
  } catch (err) {
    console.error("markInvoicePaid error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}
