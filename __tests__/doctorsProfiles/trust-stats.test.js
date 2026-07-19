// __tests__/doctorsProfiles/trust-stats.test.js
//
// Публичный «счётчик доверия» врача: агрегаты рейтинга/приёмов/пациентов.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import DoctorProfile from "../../common/models/DoctorProfile/profileDoctor.js";
import DoctorReview from "../../common/models/DoctorProfile/doctorReview.js";
import Appointment from "../../common/models/Appointment/appointment.js";
import {
  getDoctorTrustStats,
  computeDoctorBadges,
} from "../../modules/doctorsProfiles/controllers/doctorReview.controller.js";

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

const oid = () => new mongoose.Types.ObjectId();

async function makeAppt(doctorId, patientId, status, i) {
  const startsAt = new Date(Date.now() + i * 3600_000);
  const endsAt = new Date(startsAt.getTime() + 30 * 60000);
  return Appointment.create({
    doctorId,
    doctorIdUser: oid(),
    patientId,
    startsAt,
    endsAt,
    status,
  });
}

describe("getDoctorTrustStats — счётчик доверия", () => {
  it("считает рейтинг, отзывы, приёмы, уникальных пациентов, верификацию", async () => {
    const profile = await DoctorProfile.create({
      userId: oid(),
      verificationStatus: "approved",
    });
    const dpId = profile._id;

    // Отзывы: 3 видимых (5,4,3 → avg 4) + 1 скрытый (не должен считаться)
    await DoctorReview.create([
      { doctorProfileId: dpId, patientId: oid(), rating: 5, status: "visible" },
      { doctorProfileId: dpId, patientId: oid(), rating: 4, status: "visible" },
      { doctorProfileId: dpId, patientId: oid(), rating: 3, status: "visible" },
      { doctorProfileId: dpId, patientId: oid(), rating: 1, status: "hidden" },
    ]);

    // Приёмы: 2 completed у пациента A, 1 completed у B, 1 pending (не считается)
    const patientA = oid();
    const patientB = oid();
    await makeAppt(dpId, patientA, "completed", 1);
    await makeAppt(dpId, patientA, "completed", 2);
    await makeAppt(dpId, patientB, "completed", 3);
    await makeAppt(dpId, oid(), "pending", 4);

    const res = mockRes();
    await getDoctorTrustStats({ params: { doctorProfileId: String(dpId) } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.averageRating).toBe(4);
    expect(res.body.reviewCount).toBe(3);
    expect(res.body.completedAppointments).toBe(3);
    expect(res.body.patientsServed).toBe(2);
    expect(res.body.isVerified).toBe(true);
    expect(res.body.monthsOnPlatform).toBeGreaterThanOrEqual(0);
  });

  it("невалидный ID → 400", async () => {
    const res = mockRes();
    await getDoctorTrustStats({ params: { doctorProfileId: "not-an-id" } }, res);
    expect(res.statusCode).toBe(400);
  });

  it("несуществующий врач → 404", async () => {
    const res = mockRes();
    await getDoctorTrustStats({ params: { doctorProfileId: String(oid()) } }, res);
    expect(res.statusCode).toBe(404);
  });

  it("врач без отзывов и приёмов → нули, не падает", async () => {
    const profile = await DoctorProfile.create({ userId: oid() });
    const res = mockRes();
    await getDoctorTrustStats(
      { params: { doctorProfileId: String(profile._id) } },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.averageRating).toBe(0);
    expect(res.body.reviewCount).toBe(0);
    expect(res.body.completedAppointments).toBe(0);
    expect(res.body.patientsServed).toBe(0);
    expect(res.body.isVerified).toBe(false);
    expect(res.body.badges).toEqual([]);
  });
});

describe("computeDoctorBadges — бейджи из агрегатов", () => {
  const keys = (s) => computeDoctorBadges(s).map((b) => b.key);

  it("топовый врач получает набор бейджей", () => {
    const k = keys({
      completedAppointments: 500,
      averageRating: 4.9,
      reviewCount: 60,
      patientsServed: 150,
      monthsOnPlatform: 15,
    });
    expect(k).toContain("appts_500");
    expect(k).toContain("rating_excellent");
    expect(k).toContain("patients_100");
    expect(k).toContain("reviews_50");
    expect(k).toContain("veteran");
  });

  it("порог приёмов — только самый высокий (500 не даёт 100/50)", () => {
    const k = keys({ completedAppointments: 500 });
    expect(k).toContain("appts_500");
    expect(k).not.toContain("appts_100");
    expect(k).not.toContain("appts_50");
  });

  it("средний врач: 60 приёмов + рейтинг 4.6 при 6 отзывах", () => {
    const k = keys({
      completedAppointments: 60,
      averageRating: 4.6,
      reviewCount: 6,
    });
    expect(k).toEqual(expect.arrayContaining(["appts_50", "rating_high"]));
    expect(k).not.toContain("rating_excellent");
  });

  it("высокий рейтинг без достаточного числа отзывов не даёт бейдж", () => {
    const k = keys({ averageRating: 5, reviewCount: 3 });
    expect(k).not.toContain("rating_excellent");
    expect(k).not.toContain("rating_high");
  });

  it("новичок без активности — бейджей нет", () => {
    expect(computeDoctorBadges({})).toEqual([]);
  });
});
