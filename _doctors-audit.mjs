// Разовый аудит: кого заденет появление doctor_free.
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config({ path: process.argv[2] });

await mongoose.connect(process.env.MONGO_URL || process.env.MONGO_URI);
const col = mongoose.connection.collection("users");
const now = new Date();

const doctors = await col
  .find({ role: "doctor" })
  .project({ subscriptionPlan: 1, subscriptionEndsAt: 1, trialEndsAt: 1 })
  .toArray();

let onTrial = 0,
  paidActive = 0,
  paidExpired = 0,
  nothing = 0;

for (const d of doctors) {
  const paid = d.subscriptionPlan && d.subscriptionPlan !== "free";
  const active = d.subscriptionEndsAt && new Date(d.subscriptionEndsAt) > now;
  const trial = d.trialEndsAt && new Date(d.trialEndsAt) > now;

  if (paid && active) paidActive += 1;
  else if (paid && !active) paidExpired += 1;
  else if (trial) onTrial += 1;
  else nothing += 1;
}

console.log(`всего врачей:            ${doctors.length}`);
console.log(`платят, срок идёт:       ${paidActive}`);
console.log(`платили, срок вышел:     ${paidExpired}  ← упадут на doctor_free`);
console.log(`пробный период идёт:     ${onTrial}`);
console.log(`ничего нет (после проб.): ${nothing}  ← упадут на doctor_free`);

await mongoose.disconnect();
