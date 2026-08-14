// server/scripts/seedDemoDoctor.js
//
// Демонстрационный профиль врача — невролог из США.
//
// ЗАЧЕМ. Показать, как выглядит заполненная карточка специалиста: страницы
// /doctor/all-doctors и /doctor/doctor-details/:id. В базе живой профиль был
// один, и по нему нельзя было ни оценить вёрстку с длинными регалиями, ни
// показать систему.
//
// ПОЧЕМУ ВЕЗДЕ НАПИСАНО «ДЕМОНСТРАЦИОННЫЙ». Карточка стоит на медицинском
// сайте, где пациенты выбирают, к кому обратиться, и по виду не отличается от
// настоящей. Человек, нашедший её, может попытаться записаться на приём к
// специалисту, которого не существует. Поэтому:
//   — имя вымышленное и не принадлежит реальному врачу;
//   — первая строка описания прямо говорит, что профиль демонстрационный;
//   — номеров лицензий (NPI, DEA, номер лицензии штата) здесь НЕТ вовсе.
//     Правдоподобный номер — это уже поддельный документ, и совпасть он может
//     с чужим настоящим.
// Всё остальное — образование, стаж, публикации, языки — заполнено как у
// живого специалиста, чтобы карточка выглядела достоверно.
//
// Запуск:
//   node scripts/seedDemoDoctor.js           — показать, что будет создано
//   node scripts/seedDemoDoctor.js --apply   — создать
//   node scripts/seedDemoDoctor.js --remove  — удалить демо-профиль

import "dotenv/config";
import crypto from "crypto";
import mongoose from "mongoose";

const APPLY = process.argv.includes("--apply");
const REMOVE = process.argv.includes("--remove");

const RAW_KEY = process.env.ENCRYPTION_KEY || "";
const SECRET_KEY = RAW_KEY.padEnd(32, "0").slice(0, 32);

// Шифрование и слепые индексы — те же, что у модели User: поля с личными
// данными хранятся зашифрованными, а поиск идёт по хешу.
function encrypt(plain) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(SECRET_KEY), iv);
  return `${iv.toString("hex")}:${Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]).toString("hex")}`;
}
const sha256 = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");
const normalizeEmail = (e) => String(e).trim().toLowerCase();
const normalizeName = (n) => String(n).trim().toLowerCase();

// Метка, по которой демо-профиль всегда можно найти и убрать.
const DEMO_USERNAME = "dr_caldwell_demo";
const DEMO_EMAIL = "demo.neurology@docpats.com";

const FIRST_NAME = "Ethan";
const LAST_NAME = "Caldwell";

const ABOUT = `ДЕМОНСТРАЦИОННЫЙ ПРОФИЛЬ. Создан для показа возможностей платформы DocPats. Специалист вымышленный, запись на приём недоступна.

КЛИНИЧЕСКАЯ СПЕЦИАЛИЗАЦИЯ

Невролог. Основные направления: эпилепсия и пароксизмальные состояния, нейродегенеративные заболевания, рассеянный склероз, головные боли и лицевые боли, нарушения сна неврологической природы.

ОБРАЗОВАНИЕ И ПОДГОТОВКА

Медицинская школа — доктор медицины (MD), 2004–2008.
Интернатура по внутренним болезням, 2008–2009.
Резидентура по неврологии, 2009–2012, последний год — старший резидент.
Клиническая стажировка (fellowship) по эпилептологии и клинической нейрофизиологии, 2012–2014.

СЕРТИФИКАЦИЯ

Сертифицирован по неврологии и по клинической нейрофизиологии. Действующая лицензия штата. Номера сертификатов и лицензий в демонстрационном профиле не приводятся.

ОПЫТ РАБОТЫ

Более 12 лет самостоятельной практики. Ведущий невролог отделения эпилептологии, руководитель программы видео-ЭЭГ мониторинга. Консультативный приём сложных случаев, разбор пациентов с фармакорезистентной эпилепсией, предоперационная оценка.

НАУЧНАЯ РАБОТА

Более 40 публикаций в рецензируемых изданиях, из них 12 — первым автором. Соавтор двух глав в руководстве по клинической нейрофизиологии. Рецензент профильных журналов. Участник многоцентровых исследований противоэпилептических препаратов нового поколения.

ПРЕПОДАВАНИЕ

Ассоциированный профессор кафедры неврологии. Курирует резидентов и стажёров, ведёт еженедельный клинический разбор ЭЭГ.

ЯЗЫКИ

Английский — родной. Испанский — свободно. Французский — базовый.

ПРИЁМ

Очные консультации и телемедицина. Второе мнение по расшифровке ЭЭГ и МРТ головного мозга.`;

async function main() {
  await mongoose.connect(process.env.MONGO_URL || process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB || "DOCPATS_NEW",
  });
  const db = mongoose.connection.db;
  const users = db.collection("users");
  const profiles = db.collection("doctorprofiles");

  const existing = await users.findOne({ username: DEMO_USERNAME });

  if (REMOVE) {
    if (!existing) {
      console.log("демо-профиль не найден — удалять нечего");
    } else {
      await profiles.deleteMany({ userId: existing._id });
      await users.deleteOne({ _id: existing._id });
      console.log("демо-профиль удалён");
    }
    await mongoose.disconnect();
    return;
  }

  if (existing) {
    const prof = await profiles.findOne({ userId: existing._id });
    console.log("демо-профиль уже существует:");
    console.log("  userId:", String(existing._id));
    console.log("  profileId:", prof ? String(prof._id) : "(профиля нет)");
    if (prof) console.log(`  карточка: https://docpats.com/doctor/doctor-details/${prof._id}`);
    await mongoose.disconnect();
    return;
  }

  // Невролог — специальность из справочника проекта.
  const spec = await db
    .collection("specializations")
    .findOne({ name: "Neurologist" }, { projection: { _id: 1, name: 1 } });
  if (!spec) throw new Error("специальность Neurologist не найдена в справочнике");

  const userId = new mongoose.Types.ObjectId();
  const profileId = new mongoose.Types.ObjectId();

  const user = {
    _id: userId,
    firstNameEncrypted: encrypt(FIRST_NAME),
    lastNameEncrypted: encrypt(LAST_NAME),
    emailEncrypted: encrypt(DEMO_EMAIL),
    firstNameHash: sha256(normalizeName(FIRST_NAME)),
    lastNameHash: sha256(normalizeName(LAST_NAME)),
    emailHash: sha256(normalizeEmail(DEMO_EMAIL)),

    // Пароль намеренно невалидный: войти под демо-профилем нельзя.
    password: "demo-profile-no-login",
    username: DEMO_USERNAME,
    dateOfBirth: new Date("1979-06-12"),
    bio: "Невролог, эпилептология и клиническая нейрофизиология",
    role: "doctor",
    isDoctor: true,
    isPatient: false,
    isBlocked: false,
    agreement: true,
    specialization: spec._id,
    country: "United States",
    job: "Невролог, эпилептолог",
    company: "DocPats Demo Neurology Center",
    avatar: "/uploads/avatars/boy01.png",
    about: ABOUT.slice(0, 1200),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const profile = {
    _id: profileId,
    userId,
    allowVideo: true,
    company: "DocPats Demo Neurology Center, Boston, MA, United States",
    clinic: "DocPats Demo Neurology Center, Boston, MA, United States",

    isVerified: false,
    verificationStatus: "pending",

    educationInstitution:
      "Медицинская школа (доктор медицины, MD), Соединённые Штаты Америки",
    educationStartYear: 2004,
    educationEndYear: 2008,

    specializationInstitution:
      "Резидентура по неврологии и стажировка по эпилептологии и клинической нейрофизиологии, Соединённые Штаты Америки",
    specializationStartYear: 2009,
    specializationEndYear: 2014,

    address: "Boston, Massachusetts, United States",
    country: "United States",
    profileImage: "",
    about: ABOUT,

    createdAt: new Date(),
    updatedAt: new Date(),
    __v: 0,
  };

  console.log("БУДЕТ СОЗДАНО:");
  console.log(`  врач: ${FIRST_NAME} ${LAST_NAME}, ${user.job}`);
  console.log(`  специальность: ${spec.name} (${spec._id})`);
  console.log(`  страна: ${user.country}`);
  console.log(`  логин: ${DEMO_USERNAME} (вход невозможен)`);
  console.log(`  описание: ${ABOUT.length} знаков`);
  console.log(`  первая строка: ${ABOUT.split("\n")[0].slice(0, 70)}…`);

  if (APPLY) {
    await users.insertOne(user);
    await profiles.insertOne(profile);
    console.log("\nСОЗДАНО:");
    console.log(`  список врачей: https://docpats.com/doctor/all-doctors`);
    console.log(`  карточка:      https://docpats.com/doctor/doctor-details/${profileId}`);
    console.log(`  удалить:       node scripts/seedDemoDoctor.js --remove`);
  } else {
    console.log("\n(пробный прогон — ничего не создано, добавьте --apply)");
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Ошибка:", err.message);
  process.exit(1);
});
