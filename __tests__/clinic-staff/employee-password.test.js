// __tests__/clinic-staff/employee-password.test.js
//
// Тесты работы с паролем сотрудника клиники:
// восстановление (ссылка + код), сброс, смена в кабинете и блокировка входа,
// которую восстановление должно снимать.
//
// Отправка почты замокана, а ссылка и код достаются ПРЯМО ИЗ ПЕРЕХВАЧЕННОГО
// ПИСЬМА — тех же двух артефактов, что получит живой сотрудник. Никаких
// «подсмотрим в базе и срежем угол».

import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import argon2 from "argon2";

// signedUrl требует секрет: в CI он есть, при локальном запуске может не быть.
if (!process.env.SECRET) {
  process.env.SECRET = "test_secret_at_least_16_chars_long";
}

vi.mock(
  "../../modules/clinic/clinic-staff/email/sendInvitationEmail.js",
  () => ({
    sendRichEmail: vi.fn().mockResolvedValue(true),
  }),
);

import { createTestApp } from "../helpers/withSession.js";
import { sendRichEmail } from "../../modules/clinic/clinic-staff/email/sendInvitationEmail.js";
import * as clinicService from "../../modules/clinic/clinic-core/services/clinic.service.js";
import ClinicEmployee from "../../modules/clinic/clinic-staff/models/clinicEmployee.model.js";
import ClinicMembership from "../../modules/clinic/clinic-staff/models/clinicMembership.model.js";

let clinicCounter = 0;

async function setupClinicWithEmployee({
  password = "SuperSecret123!",
  role = "receptionist",
  isActive = true,
} = {}) {
  clinicCounter += 1;
  const ownerId = new mongoose.Types.ObjectId();
  const { clinic } = await clinicService.createClinic(
    { name: `Test Clinic ${clinicCounter}` },
    ownerId,
  );

  const email = `staff-${clinicCounter}-${Date.now()}@example.com`;
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  const employee = await ClinicEmployee.create({
    emailEncrypted: email,
    firstNameEncrypted: "Leyla",
    lastNameEncrypted: "Mammadova",
    passwordHash,
    isActive,
    joinedAt: new Date(),
    preferredLanguage: "ru",
    invitedBy: ownerId,
  });

  await ClinicMembership.create({
    userId: employee._id,
    clinicId: clinic._id,
    role,
    isActive: true,
    joinedAt: new Date(),
    actorType: "employee",
  });

  return { clinic, employee, password, email };
}

/**
 * Достать ссылку и код из последнего перехваченного письма — ровно то, что
 * сотрудник скопировал бы из своего почтового ящика.
 */
function lastResetEmail() {
  const calls = sendRichEmail.mock.calls;
  if (!calls.length) return null;

  const { to, htmlContent } = calls[calls.length - 1][0];
  const token = /token=([^"'&\s]+)/.exec(htmlContent)?.[1];
  const otp = />\s*(\d{6})\s*</.exec(htmlContent)?.[1];

  return {
    to,
    token: token ? decodeURIComponent(token) : null,
    otp: otp || null,
  };
}

async function requestReset(app, email) {
  return request(app)
    .post("/api/v1/clinic/employees/forgot-password")
    .send({ email });
}

beforeEach(() => {
  sendRichEmail.mockClear();
});

// ─── POST /forgot-password ────────────────────────────────────

describe("POST /api/v1/clinic/employees/forgot-password", () => {
  it("шлёт ссылку и код известному сотруднику", async () => {
    const { email } = await setupClinicWithEmployee();
    const app = createTestApp();

    const res = await requestReset(app, email);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(sendRichEmail).toHaveBeenCalledTimes(1);

    const mail = lastResetEmail();
    expect(mail.to).toBe(email);
    expect(mail.token).toBeTruthy();
    expect(mail.otp).toMatch(/^\d{6}$/);
  });

  it("на неизвестный email отвечает 200, но письма не шлёт (нет перебора почты)", async () => {
    await setupClinicWithEmployee();
    const app = createTestApp();

    const res = await requestReset(app, "ghost@example.com");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(sendRichEmail).not.toHaveBeenCalled();
  });

  it("отключённому сотруднику отвечает 200, но письма не шлёт", async () => {
    const { email } = await setupClinicWithEmployee({ isActive: false });
    const app = createTestApp();

    const res = await requestReset(app, email);

    expect(res.status).toBe(200);
    expect(sendRichEmail).not.toHaveBeenCalled();
  });

  it("повторный запрос внутри кулдауна не шлёт второе письмо, но всё равно 200", async () => {
    const { email } = await setupClinicWithEmployee();
    const app = createTestApp();

    await requestReset(app, email);
    const second = await requestReset(app, email);

    expect(second.status).toBe(200);
    // Кулдаун 60 секунд — второе письмо уйти не должно.
    expect(sendRichEmail).toHaveBeenCalledTimes(1);
  });

  it("не хранит в базе ни сам токен, ни сам код", async () => {
    const { email, employee } = await setupClinicWithEmployee();
    const app = createTestApp();

    await requestReset(app, email);
    const { token, otp } = lastResetEmail();

    const stored = await ClinicEmployee.findById(employee._id).lean();
    expect(stored.passwordResetTokenHash).toBeTruthy();
    expect(stored.passwordResetTokenHash).not.toBe(token);
    expect(stored.passwordResetOtpHash).not.toBe(otp);
    // Ни в каком виде секретов в документе быть не должно.
    expect(JSON.stringify(stored)).not.toContain(otp);
    expect(JSON.stringify(stored)).not.toContain(token);
  });
});

// ─── GET /reset-password (проверка ссылки) ────────────────────

describe("GET /api/v1/clinic/employees/reset-password", () => {
  it("подтверждает свежую ссылку и отдаёт ЗАМАСКИРОВАННЫЙ email", async () => {
    const { email } = await setupClinicWithEmployee();
    const app = createTestApp();

    await requestReset(app, email);
    const { token } = lastResetEmail();

    const res = await request(app)
      .get("/api/v1/clinic/employees/reset-password")
      .query({ token });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.attemptsLeft).toBe(3);
    // Тот, у кого в руках ссылка, не должен узнать из неё полный адрес.
    expect(res.body.maskedEmail).toContain("*");
    expect(res.body.maskedEmail).not.toBe(email);
  });

  it("отклоняет подделанный токен (409)", async () => {
    const { email } = await setupClinicWithEmployee();
    const app = createTestApp();

    await requestReset(app, email);
    const { token } = lastResetEmail();

    const res = await request(app)
      .get("/api/v1/clinic/employees/reset-password")
      .query({ token: `${token}x` });

    expect(res.status).toBe(409);
  });
});

// ─── POST /reset-password ─────────────────────────────────────

describe("POST /api/v1/clinic/employees/reset-password", () => {
  it("ставит новый пароль: он работает, старый — больше нет", async () => {
    const { email, password: oldPassword } = await setupClinicWithEmployee();
    const app = createTestApp();

    await requestReset(app, email);
    const { token, otp } = lastResetEmail();

    const newPassword = "BrandNewPass456!";
    const reset = await request(app)
      .post("/api/v1/clinic/employees/reset-password")
      .send({ token, otp, password: newPassword });

    expect(reset.status).toBe(200);
    expect(reset.body.success).toBe(true);

    const withNew = await request(app)
      .post("/api/v1/clinic/employees/login")
      .send({ email, password: newPassword });
    expect(withNew.status).toBe(200);

    const withOld = await request(app)
      .post("/api/v1/clinic/employees/login")
      .send({ email, password: oldPassword });
    expect(withOld.status).toBe(401);
  });

  it("отклоняет неверный код и сжигает ссылку после 3 попыток", async () => {
    const { email } = await setupClinicWithEmployee();
    const app = createTestApp();

    await requestReset(app, email);
    const { token, otp } = lastResetEmail();

    const wrongOtp = otp === "000000" ? "111111" : "000000";

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const res = await request(app)
        .post("/api/v1/clinic/employees/reset-password")
        .send({ token, otp: wrongOtp, password: "BrandNewPass456!" });

      expect(res.status).toBe(400);
      expect(res.body.details.attemptsLeft).toBe(3 - attempt);
    }

    // Попытки кончились → ссылка мертва даже с ПРАВИЛЬНЫМ кодом.
    const afterBurn = await request(app)
      .post("/api/v1/clinic/employees/reset-password")
      .send({ token, otp, password: "BrandNewPass456!" });

    expect(afterBurn.status).toBe(409);
  });

  it("не даёт использовать ссылку повторно", async () => {
    const { email } = await setupClinicWithEmployee();
    const app = createTestApp();

    await requestReset(app, email);
    const { token, otp } = lastResetEmail();

    const first = await request(app)
      .post("/api/v1/clinic/employees/reset-password")
      .send({ token, otp, password: "BrandNewPass456!" });
    expect(first.status).toBe(200);

    const replay = await request(app)
      .post("/api/v1/clinic/employees/reset-password")
      .send({ token, otp, password: "YetAnotherPass789!" });
    expect(replay.status).toBe(409);
  });

  it("отклоняет пароль короче 8 символов", async () => {
    const { email } = await setupClinicWithEmployee();
    const app = createTestApp();

    await requestReset(app, email);
    const { token, otp } = lastResetEmail();

    const res = await request(app)
      .post("/api/v1/clinic/employees/reset-password")
      .send({ token, otp, password: "short" });

    expect(res.status).toBe(400);
  });

  it("снимает блокировку — запертый сотрудник выбирается через восстановление", async () => {
    const { email } = await setupClinicWithEmployee();
    const app = createTestApp();

    // 5 неверных паролей → учётка заперта
    for (let i = 0; i < 5; i += 1) {
      await request(app)
        .post("/api/v1/clinic/employees/login")
        .send({ email, password: "WrongPassword!" });
    }

    const newPassword = "BrandNewPass456!";
    await requestReset(app, email);
    const { token, otp } = lastResetEmail();

    const reset = await request(app)
      .post("/api/v1/clinic/employees/reset-password")
      .send({ token, otp, password: newPassword });
    expect(reset.status).toBe(200);

    // Без снятия блокировки верный пароль тоже был бы отвергнут.
    const login = await request(app)
      .post("/api/v1/clinic/employees/login")
      .send({ email, password: newPassword });
    expect(login.status).toBe(200);
  });
});

// ─── POST /change-password ────────────────────────────────────

describe("POST /api/v1/clinic/employees/change-password", () => {
  it("меняет пароль, если текущий указан верно", async () => {
    const { email, employee, password } = await setupClinicWithEmployee();
    const app = createTestApp({ employeeId: employee._id });

    const newPassword = "BrandNewPass456!";
    const res = await request(app)
      .post("/api/v1/clinic/employees/change-password")
      .send({ currentPassword: password, newPassword });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const login = await request(createTestApp())
      .post("/api/v1/clinic/employees/login")
      .send({ email, password: newPassword });
    expect(login.status).toBe(200);
  });

  it("отклоняет неверный текущий пароль (401)", async () => {
    const { employee } = await setupClinicWithEmployee();
    const app = createTestApp({ employeeId: employee._id });

    const res = await request(app)
      .post("/api/v1/clinic/employees/change-password")
      .send({
        currentPassword: "NotMyPassword!",
        newPassword: "BrandNewPass456!",
      });

    expect(res.status).toBe(401);
  });

  it("не даёт поставить тот же пароль, что и текущий", async () => {
    const { employee, password } = await setupClinicWithEmployee();
    const app = createTestApp({ employeeId: employee._id });

    const res = await request(app)
      .post("/api/v1/clinic/employees/change-password")
      .send({ currentPassword: password, newPassword: password });

    expect(res.status).toBe(400);
  });

  it("отклоняет запрос без входа в систему (401)", async () => {
    const { password } = await setupClinicWithEmployee();
    const app = createTestApp(); // в сессии нет employeeId

    const res = await request(app)
      .post("/api/v1/clinic/employees/change-password")
      .send({ currentPassword: password, newPassword: "BrandNewPass456!" });

    expect(res.status).toBe(401);
  });
});

// ─── Блокировка входа ─────────────────────────────────────────

describe("блокировка входа сотрудника", () => {
  it("после 5 неудач запирает учётку — верный пароль тоже отвергается", async () => {
    const { email, password } = await setupClinicWithEmployee();
    const app = createTestApp();

    for (let i = 0; i < 5; i += 1) {
      const res = await request(app)
        .post("/api/v1/clinic/employees/login")
        .send({ email, password: "WrongPassword!" });
      expect(res.status).toBe(401);
    }

    const correct = await request(app)
      .post("/api/v1/clinic/employees/login")
      .send({ email, password });

    expect(correct.status).toBe(401);
    expect(correct.body.message || correct.body.error).toMatch(/lock/i);
  });

  it("успешный вход обнуляет серию неудач и пишет lastLoginAt", async () => {
    const { email, password, employee } = await setupClinicWithEmployee();
    const app = createTestApp();

    for (let i = 0; i < 3; i += 1) {
      await request(app)
        .post("/api/v1/clinic/employees/login")
        .send({ email, password: "WrongPassword!" });
    }

    const ok = await request(app)
      .post("/api/v1/clinic/employees/login")
      .send({ email, password });
    expect(ok.status).toBe(200);

    const stored = await ClinicEmployee.findById(employee._id).lean();
    expect(stored.failedLoginAttempts).toBe(0);
    expect(stored.lockoutUntil).toBeNull();
    expect(stored.lastLoginAt).toBeTruthy();
  });
});
