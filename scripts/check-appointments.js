import "dotenv/config";
import mongoose from "mongoose";

await mongoose.connect(process.env.MONGO_URL);
const db = mongoose.connection.db;

const total = await db.collection("clinic_appointments").countDocuments({});
console.log("Total appointments:", total);

const sample = await db
  .collection("clinic_appointments")
  .find({ reasonEncrypted: { $exists: true, $nin: [null, ""] } })
  .limit(10)
  .toArray();

console.log("Sample reasonEncrypted formats:");
let gcmCount = 0;
let cbcCount = 0;
sample.forEach((d) => {
  const parts = d.reasonEncrypted?.split(":").length;
  const fmt = parts === 3 ? "GCM (legacy)" : parts === 2 ? "CBC (new)" : "unknown";
  if (parts === 3) gcmCount++;
  if (parts === 2) cbcCount++;
  console.log(`  _id: ${d._id} | parts: ${parts} | ${fmt}`);
});

const fullCounts = await db
  .collection("clinic_appointments")
  .find({ reasonEncrypted: { $exists: true, $nin: [null, ""] } })
  .toArray();
const allGcm = fullCounts.filter((d) => d.reasonEncrypted?.split(":").length === 3).length;
const allCbc = fullCounts.filter((d) => d.reasonEncrypted?.split(":").length === 2).length;
console.log(`\nFull totals: GCM=${allGcm}, CBC=${allCbc}, total with reason=${fullCounts.length}`);

await mongoose.disconnect();
