// __tests__/doctorsProfiles/public-top-doctors.test.js
//
// Публичный топ врачей: сортировка по реальному рейтингу + фильтр по
// специальности.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import DoctorProfile from "../../common/models/DoctorProfile/profileDoctor.js";
import DoctorReview from "../../common/models/DoctorProfile/doctorReview.js";
import Specialization from "../../common/models/DoctorProfile/specialityOfDoctor.js";
import User from "../../common/models/Auth/users.js";
import { getPublicTopDoctors } from "../../modules/doctorsProfiles/controllers/publicTopDoctors.controller.js";
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

async function makeDoctor({ ratings = [], country, specId }) {
  const { userId } = await createTestDoctor();
  if (specId) {
    await User.updateOne({ _id: userId }, { $set: { specialization: specId } });
  }
  const profile = await DoctorProfile.create({
    userId,
    country,
    phoneHash: oid().toString(), // уникальный — обходим unique-индекс phoneHash
  });
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

describe("публичный топ врачей", () => {
  it("сортирует по рейтингу (сначала лучшие) и отдаёт нужную форму", async () => {
    const p5 = await makeDoctor({ ratings: [5, 5] }); // 5.0
    const p4 = await makeDoctor({ ratings: [4] }); // 4.0
    const p0 = await makeDoctor({ ratings: [] }); // 0

    const res = mockRes();
    await getPublicTopDoctors({ query: {} }, res);

    expect(res.body.success).toBe(true);
    const ids = res.body.doctors.map((d) => d.profileId);
    // p5 раньше p4 раньше p0
    expect(ids.indexOf(String(p5._id))).toBeLessThan(
      ids.indexOf(String(p4._id)),
    );
    expect(ids.indexOf(String(p4._id))).toBeLessThan(
      ids.indexOf(String(p0._id)),
    );

    const top = res.body.doctors[0];
    expect(top.rating).toBe(5);
    expect(top.reviewCount).toBe(2);
    expect(top.url).toContain("/public/doctor-profile/doctor-details/");
    expect(typeof top.name).toBe("string");
  });

  it("фильтрует по специальности", async () => {
    const cardio = await Specialization.create({
      name: "Cardiologist",
      category: "Cardiology",
    });
    const pedia = await Specialization.create({
      name: "Pediatrician",
      category: "Pediatrics",
    });

    const c1 = await makeDoctor({ ratings: [5], specId: cardio._id });
    await makeDoctor({ ratings: [4], specId: pedia._id });

    const res = mockRes();
    await getPublicTopDoctors({ query: { specialty: "cardio" } }, res);

    const ids = res.body.doctors.map((d) => d.profileId);
    expect(ids).toContain(String(c1._id));
    expect(res.body.doctors.every((d) => /cardio/i.test(d.specialty))).toBe(
      true,
    );
  });

  it("limit ограничивает выдачу", async () => {
    await makeDoctor({ ratings: [5] });
    await makeDoctor({ ratings: [4] });
    await makeDoctor({ ratings: [3] });

    const res = mockRes();
    await getPublicTopDoctors({ query: { limit: 2 } }, res);
    expect(res.body.doctors.length).toBe(2);
    expect(res.body.total).toBe(3);
  });
});
