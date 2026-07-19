// __tests__/doctorsProfiles/doctor-list-rating.test.js
//
// Списки врачей отдают РЕАЛЬНЫЙ рейтинг из DoctorReview (не фейковый).

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import DoctorProfile from "../../common/models/DoctorProfile/profileDoctor.js";
import DoctorReview from "../../common/models/DoctorProfile/doctorReview.js";
import AllDoctorForPatientController from "../../modules/patientsProfiles/controllers/AllDoctorForPatientController.js";
import AllDoctorController from "../../modules/doctorsProfiles/controllers/AllDoctorController.js";
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

async function seedDoctorWithReviews(ratings) {
  const { userId } = await createTestDoctor();
  const profile = await DoctorProfile.create({ userId });
  if (ratings.length) {
    await DoctorReview.create(
      ratings.map((r) => ({
        doctorProfileId: profile._id,
        patientId: oid(),
        rating: r,
        status: "visible",
      })),
    );
  }
  return profile;
}

describe("списки врачей — реальный рейтинг", () => {
  it("patient-список: rating = среднее visible-отзывов, reviewsCount = число", async () => {
    const profile = await seedDoctorWithReviews([5, 4]); // avg 4.5, count 2

    const res = mockRes();
    await AllDoctorForPatientController({ query: {} }, res);

    expect(res.body.success).toBe(true);
    const d = res.body.data.find(
      (x) => String(x.profileId) === String(profile._id),
    );
    expect(d).toBeTruthy();
    expect(d.rating).toBe(4.5);
    expect(d.reviewsCount).toBe(2);
  });

  it("patient-список: врач без отзывов → rating 0, reviewsCount 0", async () => {
    const profile = await seedDoctorWithReviews([]);
    const res = mockRes();
    await AllDoctorForPatientController({ query: {} }, res);
    const d = res.body.data.find(
      (x) => String(x.profileId) === String(profile._id),
    );
    expect(d.rating).toBe(0);
    expect(d.reviewsCount).toBe(0);
  });

  it("doctor-список: возвращает rating + reviewCount", async () => {
    const profile = await seedDoctorWithReviews([5, 5, 4]); // avg 4.7, count 3

    const res = mockRes();
    await AllDoctorController(
      { protocol: "https", get: () => "localhost", query: {} },
      res,
    );

    const arr = Array.isArray(res.body) ? res.body : [];
    const d = arr.find((x) => String(x._id) === String(profile._id));
    expect(d).toBeTruthy();
    expect(d.rating).toBe(4.7);
    expect(d.reviewCount).toBe(3);
  });
});
