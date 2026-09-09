// server/modules/feedback/services/feedbackTexts.js
//
// Готовые ответы: автоматические и выбираемые администратором.
//
// ПОЧЕМУ ТЕКСТЫ ЖИВУТ НА СЕРВЕРЕ, А НЕ В СЛОВАРЯХ ИНТЕРФЕЙСА. Ответ пишется
// в переписку один раз и остаётся там навсегда — это документ, а не надпись
// на кнопке. Если бы он собирался при показе из словаря, правка формулировки
// задним числом меняла бы то, что человеку однажды уже сказали.
//
// НА КАКОМ ЯЗЫКЕ ОТВЕЧАЕМ. На языке обращения, а не на языке того, кто
// разбирает. Человек написал по-азербайджански — он и ответ должен получить
// по-азербайджански, даже если разбирал русскоязычный администратор.
//
// ЧТО ТАКОЕ «ОТВЕТИТЬ АВТОМАТИЧЕСКИ». Две разные вещи, и обе здесь:
//   1. Подтверждение приёма — уходит само, сразу, без участия человека.
//   2. Смена состояния — «взято в работу», «сделано», «отклонено»: реплику
//      в переписку пишет сервер, а решение принимает администратор.
// Всё остальное — ручной ответ, при желании из заготовки.

const ЯЗЫКИ = ["ru", "en", "az", "tr", "ar"];

/** Язык, на котором отвечаем. Незнакомый — русский, он основной. */
export function язык(код) {
  return ЯЗЫКИ.includes(код) ? код : "ru";
}

/* Подтверждение приёма. Обещает ровно то, что мы делаем: обращение
   прочитают. Сроков не называем — обещание срока, которого никто не
   гарантировал, хуже отсутствия ответа. */
const ПРИНЯТО = {
  ru: "Спасибо, обращение получено. Мы прочитаем его и ответим здесь же — ответ придёт уведомлением.",
  en: "Thank you, your message has been received. We will read it and reply right here — you will get a notification.",
  az: "Təşəkkür edirik, müraciətiniz qəbul olundu. Onu oxuyub elə burada cavablandıracağıq — bildiriş alacaqsınız.",
  tr: "Teşekkürler, mesajınız alındı. Okuyup buradan yanıtlayacağız — bildirim alacaksınız.",
  ar: "شكرًا لك، تم استلام رسالتك. سنقرأها ونرد عليها هنا — وستصلك إشعار.",
};

/* Реплики о смене состояния. «new» отсутствует намеренно: возврат
   обращения в начало очереди — событие для нас, а не для автора. */
const СОСТОЯНИЯ = {
  in_review: {
    ru: "Обращение рассматривается.",
    en: "Your request is under review.",
    az: "Müraciət nəzərdən keçirilir.",
    tr: "Talebiniz inceleniyor.",
    ar: "طلبك قيد المراجعة.",
  },
  planned: {
    ru: "Мы согласны и включили это в план работ. Сроки назвать пока не можем, но об изменении состояния сообщим здесь.",
    en: "We agree and have added this to our plan. We cannot promise a date yet, but we will report progress here.",
    az: "Razıyıq və bunu iş planına saldıq. Hələ tarix deyə bilmirik, amma dəyişiklikləri burada bildirəcəyik.",
    tr: "Katılıyoruz ve bunu çalışma planına aldık. Henüz tarih veremiyoruz, ancak gelişmeleri burada bildireceğiz.",
    ar: "نتفق معك وقد أدرجنا ذلك في خطة العمل. لا يمكننا تحديد موعد بعد، لكننا سنبلغك بالتطورات هنا.",
  },
  in_progress: {
    ru: "Взято в работу.",
    en: "Work has started.",
    az: "İş başlanıb.",
    tr: "Çalışma başladı.",
    ar: "بدأ العمل على ذلك.",
  },
  done: {
    ru: "Готово. Спасибо, что написали — без вашего сообщения мы бы этого не сделали.",
    en: "Done. Thank you for writing — we would not have done this without your message.",
    az: "Hazırdır. Yazdığınız üçün təşəkkür edirik — mesajınız olmasaydı, bunu etməzdik.",
    tr: "Tamamlandı. Yazdığınız için teşekkürler — mesajınız olmasaydı bunu yapmazdık.",
    ar: "تم. شكرًا لمراسلتك — لم نكن لنفعل ذلك لولا رسالتك.",
  },
  declined: {
    ru: "Мы не будем это делать. Причина — ниже; если она основана на недоразумении, напишите новое обращение.",
    en: "We will not do this. The reason is below; if it is based on a misunderstanding, please send a new message.",
    az: "Bunu etməyəcəyik. Səbəb aşağıdadır; əgər anlaşılmazlıq varsa, yeni müraciət göndərin.",
    tr: "Bunu yapmayacağız. Nedeni aşağıda; bir yanlış anlaşılma varsa yeni bir mesaj gönderin.",
    ar: "لن نقوم بذلك. السبب مذكور أدناه؛ وإذا كان مبنيًا على سوء فهم، فأرسل رسالة جديدة.",
  },
};

/* Заготовки для ручного ответа. Администратор выбирает ключ, автор
   получает текст на своём языке. Список намеренно короткий: заготовка,
   которой пользуются раз в год, устаревает и вводит в заблуждение. */
export const ШАБЛОНЫ = [
  {
    key: "need_details",
    title: "Нужны подробности",
    text: {
      ru: "Спасибо. Чтобы разобраться, нужны подробности: на какой странице это случилось, что вы делали перед этим и что увидели вместо ожидаемого.",
      en: "Thank you. To investigate we need details: which page it happened on, what you did before that, and what you saw instead of what you expected.",
      az: "Təşəkkür edirik. Araşdırmaq üçün təfərrüat lazımdır: hansı səhifədə baş verdi, ondan əvvəl nə etdiniz və gözlədiyinizin əvəzinə nə gördünüz.",
      tr: "Teşekkürler. İncelemek için ayrıntılara ihtiyacımız var: hangi sayfada oldu, öncesinde ne yaptınız ve beklediğiniz yerine ne gördünüz.",
      ar: "شكرًا لك. للتحقق نحتاج تفاصيل: في أي صفحة حدث ذلك، وماذا فعلت قبله، وماذا رأيت بدلًا مما توقعته.",
    },
  },
  {
    key: "already_exists",
    title: "Это уже есть",
    text: {
      ru: "Такая возможность уже есть — видимо, мы плохо её показали. Подскажем, где искать, и подумаем, как сделать её заметнее.",
      en: "This already exists — apparently we did not surface it well. We will point you to it and think about making it more visible.",
      az: "Bu imkan artıq var — görünür, onu yaxşı göstərməmişik. Harada olduğunu deyəcəyik və daha görünən etməyi düşünəcəyik.",
      tr: "Bu özellik zaten var — görünüşe göre iyi göstermemişiz. Nerede olduğunu söyleyeceğiz ve daha görünür kılmayı düşüneceğiz.",
      ar: "هذه الإمكانية موجودة بالفعل — يبدو أننا لم نُظهرها جيدًا. سنرشدك إليها وسنفكر في جعلها أوضح.",
    },
  },
  {
    key: "fixed",
    title: "Исправлено",
    text: {
      ru: "Ошибку исправили, изменение уже на сайте. Если она повторится — напишите, мы вернёмся к ней.",
      en: "The bug is fixed and the change is already live. If it happens again, write to us and we will revisit it.",
      az: "Səhv düzəldildi, dəyişiklik artıq saytdadır. Təkrarlansa, yazın — yenidən baxacağıq.",
      tr: "Hata düzeltildi, değişiklik yayında. Tekrarlarsa yazın, yeniden bakacağız.",
      ar: "تم إصلاح الخطأ والتغيير منشور بالفعل. إذا تكرر، فاكتب لنا وسنعاود النظر فيه.",
    },
  },
  {
    key: "thanks_idea",
    title: "Спасибо за идею",
    text: {
      ru: "Спасибо за идею — она нам нравится. Пока не беремся называть срок, но обращение оставляем открытым и вернёмся к нему.",
      en: "Thank you for the idea — we like it. We will not promise a date yet, but the request stays open and we will come back to it.",
      az: "İdeya üçün təşəkkür edirik — bəyəndik. Hələlik tarix vəd etmirik, amma müraciət açıq qalır və ona qayıdacağıq.",
      tr: "Fikir için teşekkürler — beğendik. Şimdilik tarih veremiyoruz ama talep açık kalıyor ve geri döneceğiz.",
      ar: "شكرًا على الفكرة — أعجبتنا. لن نَعِد بموعد الآن، لكن الطلب يبقى مفتوحًا وسنعود إليه.",
    },
  },
  {
    key: "not_a_bug",
    title: "Работает как задумано",
    text: {
      ru: "Проверили: сейчас всё работает так, как задумано. Ниже объясняем почему — если задумано неудачно, скажите, и мы это обсудим.",
      en: "We checked: it currently works as intended. The reasoning is below — if the intent itself is wrong, tell us and we will discuss it.",
      az: "Yoxladıq: hazırda nəzərdə tutulduğu kimi işləyir. Səbəb aşağıdadır — əgər fikir özü səhvdirsə, deyin, müzakirə edək.",
      tr: "Kontrol ettik: şu an tasarlandığı gibi çalışıyor. Gerekçe aşağıda — tasarımın kendisi yanlışsa söyleyin, tartışalım.",
      ar: "تحققنا: يعمل حاليًا كما هو مقصود. السبب أدناه — وإذا كان التصميم نفسه خاطئًا فأخبرنا لنناقشه.",
    },
  },
];

/** Текст подтверждения приёма на языке обращения. */
export function текстПринято(локаль) {
  return ПРИНЯТО[язык(локаль)];
}

/**
 * Реплика о смене состояния — или null, если о нём не сообщают.
 * Пустая строка вместо null означала бы пустое сообщение в переписке.
 */
export function текстСостояния(состояние, локаль) {
  const набор = СОСТОЯНИЯ[состояние];
  return набор ? набор[язык(локаль)] : null;
}

/** Текст заготовки на языке обращения; неизвестный ключ — null. */
export function текстШаблона(ключ, локаль) {
  const шаблон = ШАБЛОНЫ.find((ш) => ш.key === ключ);
  return шаблон ? шаблон.text[язык(локаль)] : null;
}

export default {
  ШАБЛОНЫ,
  текстПринято,
  текстСостояния,
  текстШаблона,
};
