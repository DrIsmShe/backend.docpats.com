// __tests__/doctorsProfiles/review-reply.test.js
//
// Ответ врача на отзыв: только владелец профиля, валидация, отдача в списке.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import DoctorProfile from "../../common/models/DoctorProfile/profileDoctor.js";
import DoctorReview from "../../common/models/DoctorProfile/doctorReview.js";
import {
  replyToDoctorReview,
  getDoctorReviews,
} from "../../modules/doctorsProfiles/controllers/doctorReview.controller.js";
import { createTestDoctor } from "../helpers/createTestUser.js";

const oid = () => new mongoose.Types.ObjectId();

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

async function seed() {
  const owner = await createTestDoctor();
  const profile = await DoctorProfile.create({ userId: owner.userId });
  const review = await DoctorReview.create({
    doctorProfileId: profile._id,
    patientId: oid(),
    rating: 4,
    status: "visible",
  });
  return { owner, profile, review };
}

describe("ответ врача на отзыв", () => {
  it("владелец профиля отвечает — сохраняется", async () => {
    const { owner, review } = await seed();
    const res = mockRes();
    await replyToDoctorReview(
      {
        userId: String(owner.userId),
        params: { reviewId: String(review._id) },
        body: { reply: "Спасибо за отзыв!" },
      },
      res,
    );
    expect(res.body.success).toBe(true);
    const updated = await DoctorReview.findById(review._id);
    expect(updated.reply).toBe("Спасибо за отзыв!");
    expect(updated.repliedAt).toBeTruthy();
  });

  it("чужой врач не может ответить → 403", async () => {
    const { review } = await seed();
    const other = await createTestDoctor();
    const res = mockRes();
    await replyToDoctorReview(
      {
        userId: String(other.userId),
        params: { reviewId: String(review._id) },
        body: { reply: "Привет" },
      },
      res,
    );
    expect(res.statusCode).toBe(403);
  });

  it("пустой ответ → 400", async () => {
    const { owner, review } = await seed();
    const res = mockRes();
    await replyToDoctorReview(
      {
        userId: String(owner.userId),
        params: { reviewId: String(review._id) },
        body: { reply: "   " },
      },
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  it("getDoctorReviews отдаёт reply", async () => {
    const { owner, profile, review } = await seed();
    await replyToDoctorReview(
      {
        userId: String(owner.userId),
        params: { reviewId: String(review._id) },
        body: { reply: "Рад был помочь" },
      },
      mockRes(),
    );
    const res = mockRes();
    await getDoctorReviews(
      { params: { doctorProfileId: String(profile._id) } },
      res,
    );
    const r = res.body.reviews.find(
      (x) => String(x._id) === String(review._id),
    );
    expect(r.reply).toBe("Рад был помочь");
  });
});
