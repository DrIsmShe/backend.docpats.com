// __tests__/admin/adminDoctors.test.js
//
// Заведение врачей администратором.
//
// Здесь две вещи, которые ломаются молча и потому проверяются отдельно:
//
//   1. ШИФРОВАНИЕ. Имя, фамилия и почта хранятся зашифрованными, рядом лежат
//      хеши для поиска. Пре-хуки Mongoose на прямых операциях драйвера не
//      срабатывают, поэтому шифрование выполняется в контроллере вручную.
//      Забыть хеш — значит завести врача, которого потом не найти.
//
//   2. ПАРА ДОКУМЕНТОВ. Профиль это users + doctorprofiles. Если создать
//      только первый, врач появится в системе без карточки: в каталоге его
//      видно, а открыть нечего.

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";
import crypto from "crypto";

// Хранилище подменяем: настоящий uploadFile в тестовой среде писал бы файлы
// в папку uploads рядом с исходниками, а в проде уходил бы в Cloudflare R2.
// Проверяем маршрут и проверки доступа, а не работу S3-клиента.
vi.mock("../../common/middlewares/uploadMiddleware.js", async (importOriginal) => ({
  ...(await importOriginal()),
  uploadFile: vi.fn(async (file) => `https://cdn.test/${file.originalname}.webp`),
}));

import adminRoute from "../../modules/admin/routes/adminRoute.js";
import { createTestDoctor } from "../helpers/createTestUser.js";

function makeApp({ userId = null } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = userId ? { userId: String(userId) } : {};
    next();
  });
  app.use("/api/admin", adminRoute);
  return app;
}

const sha256 = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");

async function makeAdmin() {
  const { userId } = await createTestDoctor({ role: "admin", isDoctor: false });
  return userId;
}

const VALID = {
  firstName: "Анна",
  lastName: "Петрова",
  email: "anna.petrova@clinic.test",
  job: "Невролог",
  clinic: "Городская клиническая больница №1",
  country: "Россия",
  about: "Невролог, 12 лет практики. Эпилептология, головные боли.",
  educationInstitution: "Первый МГМУ им. Сеченова",
  educationStartYear: 2006,
  educationEndYear: 2012,
};

describe("доступ", () => {
  it("без сессии — 401", async () => {
    const res = await request(makeApp()).post("/api/admin/doctors").send(VALID);
    expect(res.status).toBe(401);
  });

  it("врачу — 403: заводить врачей может только администратор", async () => {
    const { userId } = await createTestDoctor();
    const res = await request(makeApp({ userId }))
      .post("/api/admin/doctors")
      .send(VALID);
    expect(res.status).toBe(403);
  });
});

describe("создание врача", () => {
  let admin;

  beforeEach(async () => {
    admin = await makeAdmin();
  });

  const post = (body) =>
    request(makeApp({ userId: admin })).post("/api/admin/doctors").send(body);

  it("создаёт и запись пользователя, и карточку", async () => {
    const res = await post(VALID);

    expect(res.status).toBe(201);
    expect(res.body.userId).toBeTruthy();
    expect(res.body.profileId).toBeTruthy();
    // Ссылка на публичную карточку — по ней администратор сразу проверит,
    // как профиль видит пациент.
    expect(res.body.publicUrl).toContain(res.body.profileId);

    const db = mongoose.connection.db;
    const user = await db
      .collection("users")
      .findOne({ _id: new mongoose.Types.ObjectId(res.body.userId) });
    const profile = await db
      .collection("doctorprofiles")
      .findOne({ userId: user._id });

    expect(user.role).toBe("doctor");
    expect(user.isDoctor).toBe(true);
    expect(profile).toBeTruthy();
    expect(profile.clinic).toBe(VALID.clinic);
    expect(profile.educationStartYear).toBe(2006);
  });

  it("шифрует личные данные и кладёт хеши для поиска", async () => {
    const res = await post(VALID);

    const user = await mongoose.connection.db
      .collection("users")
      .findOne({ _id: new mongoose.Types.ObjectId(res.body.userId) });

    // В базе не должно быть имени открытым текстом.
    expect(user.firstNameEncrypted).toContain(":");
    expect(JSON.stringify(user)).not.toContain(VALID.firstName);

    // Без хешей врача нельзя найти, а модель откажется его сохранять.
    expect(user.emailHash).toBe(sha256(VALID.email.toLowerCase()));
    expect(user.firstNameHash).toBe(sha256(VALID.firstName.toLowerCase()));
    expect(user.lastNameHash).toBe(sha256(VALID.lastName.toLowerCase()));
  });

  it("не заводит второго врача с той же почтой", async () => {
    await post(VALID);
    const again = await post({ ...VALID, firstName: "Другая" });

    // Почта — единственный настоящий идентификатор: дубль сломал бы вход и
    // восстановление пароля.
    expect(again.status).toBe(409);
  });

  it("требует имя, фамилию и корректную почту", async () => {
    expect((await post({ ...VALID, firstName: "" })).status).toBe(400);
    expect((await post({ ...VALID, lastName: "" })).status).toBe(400);
    expect((await post({ ...VALID, email: "не-почта" })).status).toBe(400);
  });

  it("не задаёт пароль: администратор не может войти под врачом", async () => {
    const res = await post(VALID);
    const user = await mongoose.connection.db
      .collection("users")
      .findOne({ _id: new mongoose.Types.ObjectId(res.body.userId) });

    // Значение заведомо не является хешем argon2, поэтому вход невозможен —
    // врач заходит по ссылке восстановления пароля.
    expect(user.password).toMatch(/^pending-invite-/);
  });

  it("отбрасывает несуществующие годы обучения", async () => {
    const res = await post({ ...VALID, educationStartYear: 1200 });
    const profile = await mongoose.connection.db
      .collection("doctorprofiles")
      .findOne({ userId: new mongoose.Types.ObjectId(res.body.userId) });

    expect(profile.educationStartYear).toBeNull();
  });
});

describe("список и правка", () => {
  let admin;

  beforeEach(async () => {
    admin = await makeAdmin();
  });

  const app = () => makeApp({ userId: admin });

  it("список отдаёт имена расшифрованными", async () => {
    await request(app()).post("/api/admin/doctors").send(VALID);

    const res = await request(app()).get("/api/admin/doctors");
    const found = res.body.doctors.find((d) => d.email === VALID.email);

    // Расшифровка идёт на сервере: ключ не должен покидать его.
    expect(found.firstName).toBe(VALID.firstName);
    expect(found.lastName).toBe(VALID.lastName);
  });

  it("правит профиль и не плодит второй", async () => {
    const created = await request(app()).post("/api/admin/doctors").send(VALID);

    const res = await request(app())
      .put(`/api/admin/doctors/${created.body.userId}`)
      .send({ clinic: "Новая клиника", job: "Невролог, эпилептолог" });

    expect(res.status).toBe(200);

    const profiles = await mongoose.connection.db
      .collection("doctorprofiles")
      .find({ userId: new mongoose.Types.ObjectId(created.body.userId) })
      .toArray();

    expect(profiles).toHaveLength(1);
    expect(profiles[0].clinic).toBe("Новая клиника");
  });

  it("не даёт занять чужую почту при правке", async () => {
    const first = await request(app()).post("/api/admin/doctors").send(VALID);
    await request(app())
      .post("/api/admin/doctors")
      .send({ ...VALID, email: "second@clinic.test" });

    const res = await request(app())
      .put(`/api/admin/doctors/${first.body.userId}`)
      .send({ email: "second@clinic.test" });

    expect(res.status).toBe(409);
  });

  it("удаление скрывает врача, но не стирает запись", async () => {
    const created = await request(app()).post("/api/admin/doctors").send(VALID);

    await request(app()).delete(`/api/admin/doctors/${created.body.userId}`);

    const db = mongoose.connection.db;
    const user = await db
      .collection("users")
      .findOne({ _id: new mongoose.Types.ObjectId(created.body.userId) });
    const profile = await db
      .collection("doctorprofiles")
      .findOne({ userId: user._id });

    // На врача ссылаются приёмы, переписка и медицинские записи — стереть
    // запись значило бы оставить их висеть в пустоту.
    expect(user).toBeTruthy();
    expect(user.isDeleted).toBe(true);
    // А карточка из каталога уходит.
    expect(profile).toBeNull();

    const list = await request(app()).get("/api/admin/doctors");
    expect(list.body.doctors.some((d) => d.email === VALID.email)).toBe(false);
  });

  it("принимает фотографию файлом и возвращает ссылку", async () => {
    // 1x1 PNG — минимальная настоящая картинка: multer фильтрует по MIME и
    // расширению, поэтому подсунуть произвольные байты нельзя.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );

    const res = await request(app())
      .post("/api/admin/doctors/photo")
      .attach("image", png, { filename: "avatar.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    // Ссылку форма подставляет в profileImage — в базу маршрут не пишет.
    expect(res.body.url).toContain("avatar.png");
  });

  it("не принимает не-картинку", async () => {
    const res = await request(app())
      .post("/api/admin/doctors/photo")
      .attach("image", Buffer.from("%PDF-1.4"), {
        filename: "scan.pdf",
        contentType: "application/pdf",
      });

    // Ошибка загрузчика — это ошибка запроса, а не сбой сервера.
    expect(res.status).toBe(400);
  });

  it("загрузка фото закрыта для не-администратора", async () => {
    const { userId } = await createTestDoctor();
    const res = await request(makeApp({ userId }))
      .post("/api/admin/doctors/photo")
      .attach("image", Buffer.from("x"), "a.png");

    expect(res.status).toBe(403);
  });

  it("справочник специальностей не путается с идентификатором врача", async () => {
    // Маршрут /doctors/specializations должен стоять раньше /doctors/:userId,
    // иначе Express примет слово за идентификатор и упадёт на ObjectId.
    const res = await request(app()).get("/api/admin/doctors/specializations");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.specializations)).toBe(true);
  });
});
