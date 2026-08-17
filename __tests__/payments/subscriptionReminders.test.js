// __tests__/payments/subscriptionReminders.test.js
//
// Напоминания о продлении платной подписки.
//
// Существовали только для пробного периода. Платная подписка кончалась
// молча: человек узнавал об этом, упершись в лимит бесплатного тарифа
// посреди работы.
//
// Главное, что проверяем, — флаги сбрасываются при продлении. Иначе
// второе продление пройдёт без единого письма: флаги-то уже стоят.

import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

const sent = [];
vi.mock("../../modules/auth/services/emailService.js", () => ({
  sendEmail: vi.fn(async (to, subject, text) => {
    sent.push({ to, subject, text });
    return { messageId: "test" };
  }),
}));

const { sendEmail } = await import("../../modules/auth/services/emailService.js");
import User from "../../common/models/Auth/users.js";
import { runSubscriptionReminderCheck } from "../../jobs/checkSubscriptionReminders.js";

const DAY = 24 * 60 * 60 * 1000;
let counter = 0;

async function makeSubscriber(endsInDays, over = {}) {
  counter += 1;
  const suffix = `${Date.now()}-${counter}`;
  return User.create({
    emailEncrypted: `sub-${suffix}@example.com`,
    firstNameEncrypted: "Тест",
    lastNameEncrypted: "Подписчик",
    emailHash: `h-${suffix}`,
    firstNameHash: "placeholder",
    lastNameHash: "placeholder",
    username: `sub_${suffix}`.replace(/[^a-z0-9_]/gi, ""),
    password: "hashed-password-placeholder",
    dateOfBirth: new Date("1985-01-01"),
    bio: "test",
    agreement: true,
    role: "doctor",
    trialEndsAt: new Date(Date.now() - DAY),
    subscriptionPlan: "doctor_super",
    subscriptionEndsAt: new Date(Date.now() + endsInDays * DAY),
    ...over,
  });
}

describe("напоминания о продлении подписки", () => {
  beforeEach(() => {
    sent.length = 0;
    sendEmail.mockClear();
  });

  it("за неделю до окончания уходит письмо с названием тарифа", async () => {
    await makeSubscriber(7);
    const res = await runSubscriptionReminderCheck();

    expect(res.sent).toBe(1);
    expect(sent[0].subject).toContain("Doctor Growth");
    expect(sent[0].subject).toMatch(/неделю/);
  });

  it("за день — своё письмо", async () => {
    await makeSubscriber(1);
    await runSubscriptionReminderCheck();

    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/один день/);
  });

  it("после окончания сообщает, что данные остались при человеке", async () => {
    await makeSubscriber(-1);
    await runSubscriptionReminderCheck();

    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/закончилась/);
    // Главный страх при окончании подписки — «у меня всё пропало».
    expect(sent[0].text).toMatch(/данные никуда не делись/i);
  });

  it("повторный запуск в тот же день не задваивает письмо", async () => {
    await makeSubscriber(7);
    await runSubscriptionReminderCheck();
    await runSubscriptionReminderCheck();

    expect(sent).toHaveLength(1);
  });

  it("после продления напоминания идут заново — флаги привязаны к сроку", async () => {
    const user = await makeSubscriber(7);
    await runSubscriptionReminderCheck();
    expect(sent).toHaveLength(1);

    // Продлили на год: срок сменился.
    user.subscriptionEndsAt = new Date(Date.now() + 372 * DAY);
    await user.save({ validateModifiedOnly: true });

    // Год прошёл, снова неделя до конца.
    user.subscriptionEndsAt = new Date(Date.now() + 7 * DAY);
    await user.save({ validateModifiedOnly: true });

    sent.length = 0;
    await runSubscriptionReminderCheck();

    // Без привязки флагов к сроку это письмо не ушло бы никогда.
    expect(sent).toHaveLength(1);
  });

  it("бесплатному аккаунту не пишем", async () => {
    await makeSubscriber(7, { subscriptionPlan: null });
    const res = await runSubscriptionReminderCheck();

    expect(res.sent).toBe(0);
  });

  it("падение SMTP не выставляет флаг: завтра попробуем снова", async () => {
    await makeSubscriber(7);
    sendEmail.mockRejectedValueOnce(new Error("SMTP down"));

    const first = await runSubscriptionReminderCheck();
    expect(first.failed).toBe(1);

    sent.length = 0;
    const second = await runSubscriptionReminderCheck();
    expect(second.sent).toBe(1);
  });
});
