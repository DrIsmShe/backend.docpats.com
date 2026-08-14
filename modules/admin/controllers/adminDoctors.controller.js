// modules/admin/controllers/adminDoctors.controller.js
//
// Заведение и правка профилей врачей администратором.
//
// ЗАЧЕМ. Врач заполняет профиль сам, но не всегда: клиника приводит сразу
// нескольких специалистов, у человека нет времени, данные приходят на бумаге.
// Раньше в таких случаях профиль создавался руками в базе.
//
// ЧТО ЗДЕСЬ ХРАНИТСЯ. Профиль состоит из двух документов: `users` (личные
// данные, роль, специальность) и `doctorprofiles` (клиника, образование,
// регалии, описание). Они всегда создаются и удаляются вместе — иначе в
// каталоге появляется врач без карточки или карточка без врача.
//
// ЛИЧНЫЕ ДАННЫЕ ШИФРУЮТСЯ. Имя, фамилия, почта и телефон в базе лежат
// зашифрованными (AES-256-CBC), а рядом — HMAC-хеш для поиска. Это не
// формальность: по этим полям врача можно найти, и модель отказывается
// сохранять документ без хешей. Логика повторяет модель User намеренно —
// пре-хуки Mongoose не срабатывают на прямых операциях драйвера.

import crypto from "crypto";
import mongoose from "mongoose";
import User from "../../../common/models/Auth/users.js";
import { auditAdminAccess } from "../adminAudit.js";

const RAW_KEY = process.env.ENCRYPTION_KEY || "";
const SECRET_KEY = RAW_KEY.padEnd(32, "0").slice(0, 32);

function encrypt(plain) {
  const value = String(plain ?? "");
  if (!value) return "";
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(SECRET_KEY),
    iv,
  );
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${data.toString("hex")}`;
}

function decrypt(value) {
  const raw = String(value || "");
  if (!raw.includes(":")) return raw;
  try {
    const [ivHex, dataHex] = raw.split(":");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(SECRET_KEY),
      Buffer.from(ivHex, "hex"),
    );
    return (
      decipher.update(Buffer.from(dataHex, "hex")).toString("utf8") +
      decipher.final("utf8")
    );
  } catch {
    return "";
  }
}

const sha256 = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");
const normEmail = (e) => String(e || "").trim().toLowerCase();
const normName = (n) => String(n || "").trim().toLowerCase();

/** Логин из имени: латиница, цифры, точка и дефис — как требует модель. */
function buildUsername(first, last) {
  const base = `${first}.${last}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 22);
  const tail = crypto.randomBytes(3).toString("hex");
  return `${base || "doctor"}_${tail}`;
}

const str = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const year = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 1900 && n <= 2100 ? n : null;
};

/**
 * GET /api/admin/doctors
 *
 * Список врачей для админки. Имена расшифровываются здесь, а не на клиенте:
 * ключ шифрования не должен покидать сервер.
 */
export async function listDoctors(req, res) {
  const search = str(req.query.q, 100);
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const db = mongoose.connection.db;
  const query = { role: "doctor", isDeleted: { $ne: true } };

  // Поиск идёт по хешу: зашифрованные поля искать подстрокой невозможно —
  // у одного и того же имени каждый раз разный шифротекст.
  if (search) {
    query.$or = [
      { firstNameHash: sha256(normName(search)) },
      { lastNameHash: sha256(normName(search)) },
      { emailHash: sha256(normEmail(search)) },
      { username: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
    ];
  }

  const users = await db
    .collection("users")
    .find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .project({
      firstNameEncrypted: 1, lastNameEncrypted: 1, emailEncrypted: 1,
      username: 1, country: 1, job: 1, company: 1, specialization: 1,
      isBlocked: 1, createdAt: 1, avatar: 1,
    })
    .toArray();

  const ids = users.map((u) => u._id);
  const profiles = await db
    .collection("doctorprofiles")
    .find({ userId: { $in: ids } })
    .project({ userId: 1, clinic: 1, country: 1, verificationStatus: 1 })
    .toArray();

  const profileByUser = new Map(profiles.map((p) => [String(p.userId), p]));

  const specs = await db
    .collection("specializations")
    .find({ _id: { $in: users.map((u) => u.specialization).filter(Boolean) } })
    .project({ name: 1 })
    .toArray();
  const specById = new Map(specs.map((s) => [String(s._id), s.name]));

  res.json({
    doctors: users.map((u) => {
      const profile = profileByUser.get(String(u._id));
      return {
        userId: String(u._id),
        profileId: profile ? String(profile._id) : null,
        firstName: decrypt(u.firstNameEncrypted),
        lastName: decrypt(u.lastNameEncrypted),
        email: decrypt(u.emailEncrypted),
        username: u.username,
        specialization: specById.get(String(u.specialization)) || null,
        specializationId: u.specialization ? String(u.specialization) : null,
        country: u.country || profile?.country || "",
        job: u.job || "",
        clinic: profile?.clinic || u.company || "",
        verificationStatus: profile?.verificationStatus || null,
        isBlocked: Boolean(u.isBlocked),
        createdAt: u.createdAt,
        // Ссылка на публичную карточку — чтобы из админки сразу посмотреть,
        // как профиль выглядит для пациента.
        publicUrl: profile ? `/doctor/doctor-details/${profile._id}` : null,
      };
    }),
    total: users.length,
  });
}

/** GET /api/admin/doctors/specializations — справочник для выпадающего списка. */
export async function listSpecializations(req, res) {
  const rows = await mongoose.connection.db
    .collection("specializations")
    .find({})
    .project({ name: 1, category: 1 })
    .sort({ category: 1, name: 1 })
    .toArray();

  res.json({
    specializations: rows.map((r) => ({
      id: String(r._id),
      name: r.name,
      category: r.category || "",
    })),
  });
}

/** GET /api/admin/doctors/:userId — всё о враче для формы правки. */
export async function getDoctor(req, res) {
  const db = mongoose.connection.db;
  const userId = new mongoose.Types.ObjectId(req.params.userId);

  const user = await db.collection("users").findOne({ _id: userId, role: "doctor" });
  if (!user) return res.status(404).json({ message: "Врач не найден" });

  const profile = await db.collection("doctorprofiles").findOne({ userId });

  res.json({
    doctor: {
      userId: String(user._id),
      profileId: profile ? String(profile._id) : null,
      firstName: decrypt(user.firstNameEncrypted),
      lastName: decrypt(user.lastNameEncrypted),
      email: decrypt(user.emailEncrypted),
      phone: decrypt(profile?.phoneEncrypted),
      username: user.username,
      dateOfBirth: user.dateOfBirth,
      bio: user.bio || "",
      specializationId: user.specialization ? String(user.specialization) : "",
      country: user.country || profile?.country || "",
      job: user.job || "",
      isBlocked: Boolean(user.isBlocked),

      clinic: profile?.clinic || "",
      company: profile?.company || "",
      address: profile?.address || "",
      profileImage: profile?.profileImage || "",
      about: profile?.about || "",
      allowVideo: profile?.allowVideo !== false,
      verificationStatus: profile?.verificationStatus || "pending",
      educationInstitution: profile?.educationInstitution || "",
      educationStartYear: profile?.educationStartYear || null,
      educationEndYear: profile?.educationEndYear || null,
      specializationInstitution: profile?.specializationInstitution || "",
      specializationStartYear: profile?.specializationStartYear || null,
      specializationEndYear: profile?.specializationEndYear || null,
    },
  });
}

/** Поля профиля из тела запроса — общие для создания и правки. */
function profileFields(body) {
  return {
    clinic: str(body.clinic, 300),
    company: str(body.company || body.clinic, 300),
    address: str(body.address, 300),
    country: str(body.country, 100),
    profileImage: str(body.profileImage, 500),
    about: str(body.about, 20000),
    allowVideo: body.allowVideo !== false,
    verificationStatus: ["pending", "approved", "rejected"].includes(
      body.verificationStatus,
    )
      ? body.verificationStatus
      : "pending",
    educationInstitution: str(body.educationInstitution, 300),
    educationStartYear: year(body.educationStartYear),
    educationEndYear: year(body.educationEndYear),
    specializationInstitution: str(body.specializationInstitution, 300),
    specializationStartYear: year(body.specializationStartYear),
    specializationEndYear: year(body.specializationEndYear),
  };
}

/**
 * POST /api/admin/doctors
 *
 * Создаёт врача: запись в users и карточку в doctorprofiles.
 */
export async function createDoctor(req, res) {
  const db = mongoose.connection.db;
  const body = req.body || {};

  const firstName = str(body.firstName, 100);
  const lastName = str(body.lastName, 100);
  const email = normEmail(body.email);

  if (!firstName || !lastName) {
    return res.status(400).json({ message: "Имя и фамилия обязательны" });
  }
  if (!email || !email.includes("@")) {
    return res.status(400).json({ message: "Нужна корректная почта" });
  }

  // Почта — единственный настоящий идентификатор врача в системе. Дубль
  // сломал бы вход и восстановление пароля.
  const emailHash = sha256(email);
  const clash = await db.collection("users").findOne({ emailHash });
  if (clash) {
    return res.status(409).json({ message: "Врач с такой почтой уже заведён" });
  }

  const userId = new mongoose.Types.ObjectId();
  const profileId = new mongoose.Types.ObjectId();
  const now = new Date();
  const fields = profileFields(body);

  const user = {
    _id: userId,
    firstNameEncrypted: encrypt(firstName),
    lastNameEncrypted: encrypt(lastName),
    emailEncrypted: encrypt(email),
    firstNameHash: sha256(normName(firstName)),
    lastNameHash: sha256(normName(lastName)),
    emailHash,

    // Врач входит по ссылке восстановления пароля: администратор пароля не
    // задаёт и, значит, не может войти под чужим именем.
    password: `pending-invite-${crypto.randomBytes(16).toString("hex")}`,
    username: str(body.username, 30) || buildUsername(firstName, lastName),
    dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : new Date("1980-01-01"),
    bio: str(body.bio, 500) || str(body.job, 500) || "Врач",
    role: "doctor",
    isDoctor: true,
    isPatient: false,
    isBlocked: false,
    agreement: true,
    specialization: body.specializationId
      ? new mongoose.Types.ObjectId(String(body.specializationId))
      : null,
    country: fields.country,
    job: str(body.job, 200),
    company: fields.company,
    avatar: str(body.profileImage, 500) || "/uploads/avatars/boy01.png",
    about: str(body.about, 1200),
    createdAt: now,
    updatedAt: now,
  };

  const profile = {
    _id: profileId,
    userId,
    ...fields,
    phoneEncrypted: body.phone ? encrypt(str(body.phone, 40)) : "",
    phoneHash: body.phone ? sha256(str(body.phone, 40).replace(/\D/g, "")) : "",
    isVerified: false,
    createdAt: now,
    updatedAt: now,
    __v: 0,
  };

  await db.collection("users").insertOne(user);
  await db.collection("doctorprofiles").insertOne(profile);

  // В аудит — только структурные данные: имя врача это персональные сведения,
  // а журнал HIPAA их содержать не должен.
  auditAdminAccess(req, {
    action: "admin.doctor.create",
    resourceType: "doctor-profile",
    resourceId: String(userId),
    metadata: { hasAbout: Boolean(fields.about), specializationSet: Boolean(user.specialization) },
  });

  res.status(201).json({
    success: true,
    userId: String(userId),
    profileId: String(profileId),
    publicUrl: `/doctor/doctor-details/${profileId}`,
  });
}

/** PUT /api/admin/doctors/:userId — правка. */
export async function updateDoctor(req, res) {
  const db = mongoose.connection.db;
  const userId = new mongoose.Types.ObjectId(req.params.userId);
  const body = req.body || {};

  const user = await db.collection("users").findOne({ _id: userId, role: "doctor" });
  if (!user) return res.status(404).json({ message: "Врач не найден" });

  const fields = profileFields(body);
  const userPatch = { updatedAt: new Date() };

  if (body.firstName) {
    userPatch.firstNameEncrypted = encrypt(str(body.firstName, 100));
    userPatch.firstNameHash = sha256(normName(body.firstName));
  }
  if (body.lastName) {
    userPatch.lastNameEncrypted = encrypt(str(body.lastName, 100));
    userPatch.lastNameHash = sha256(normName(body.lastName));
  }
  if (body.email) {
    const email = normEmail(body.email);
    const hash = sha256(email);
    const clash = await db
      .collection("users")
      .findOne({ emailHash: hash, _id: { $ne: userId } });
    if (clash) return res.status(409).json({ message: "Эта почта уже занята" });
    userPatch.emailEncrypted = encrypt(email);
    userPatch.emailHash = hash;
  }
  if (body.specializationId !== undefined) {
    userPatch.specialization = body.specializationId
      ? new mongoose.Types.ObjectId(String(body.specializationId))
      : null;
  }
  if (body.job !== undefined) userPatch.job = str(body.job, 200);
  if (body.bio !== undefined) userPatch.bio = str(body.bio, 500);
  if (body.isBlocked !== undefined) userPatch.isBlocked = Boolean(body.isBlocked);
  if (fields.country) userPatch.country = fields.country;
  if (fields.company) userPatch.company = fields.company;
  if (fields.about) userPatch.about = fields.about.slice(0, 1200);
  if (fields.profileImage) userPatch.avatar = fields.profileImage;

  await db.collection("users").updateOne({ _id: userId }, { $set: userPatch });

  const profilePatch = { ...fields, updatedAt: new Date() };
  if (body.phone !== undefined) {
    profilePatch.phoneEncrypted = body.phone ? encrypt(str(body.phone, 40)) : "";
    profilePatch.phoneHash = body.phone
      ? sha256(str(body.phone, 40).replace(/\D/g, ""))
      : "";
  }

  // upsert: у врача, заведённого до появления карточек, профиля может не быть.
  await db
    .collection("doctorprofiles")
    .updateOne(
      { userId },
      { $set: profilePatch, $setOnInsert: { userId, isVerified: false, createdAt: new Date(), __v: 0 } },
      { upsert: true },
    );

  const profile = await db.collection("doctorprofiles").findOne({ userId });

  auditAdminAccess(req, {
    action: "admin.doctor.update",
    resourceType: "doctor-profile",
    resourceId: String(userId),
    metadata: { fieldsChanged: Object.keys(userPatch).length },
  });

  res.json({
    success: true,
    userId: String(userId),
    profileId: profile ? String(profile._id) : null,
    publicUrl: profile ? `/doctor/doctor-details/${profile._id}` : null,
  });
}

/**
 * DELETE /api/admin/doctors/:userId
 *
 * Врач помечается удалённым, а не стирается: на него ссылаются приёмы,
 * переписка и медицинские записи, и физическое удаление оставило бы их
 * висеть в пустоту. Карточка при этом убирается из каталога.
 */
export async function deleteDoctor(req, res) {
  const db = mongoose.connection.db;
  const userId = new mongoose.Types.ObjectId(req.params.userId);

  const user = await db.collection("users").findOne({ _id: userId, role: "doctor" });
  if (!user) return res.status(404).json({ message: "Врач не найден" });

  await db.collection("users").updateOne(
    { _id: userId },
    { $set: { isDeleted: true, deletedAt: new Date(), isBlocked: true } },
  );
  await db.collection("doctorprofiles").deleteMany({ userId });

  auditAdminAccess(req, {
    action: "admin.doctor.delete",
    resourceType: "doctor-profile",
    resourceId: String(userId),
    metadata: { softDeleted: true },
  });

  res.json({ success: true });
}

export default {
  listDoctors,
  listSpecializations,
  getDoctor,
  createDoctor,
  updateDoctor,
  deleteDoctor,
};
