import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const uri =
  process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;
if (!uri) {
  console.error("No MONGO_URI/MONGODB_URI/DATABASE_URL in .env");
  process.exit(1);
}
console.log("Using URI:", uri.replace(/:[^:@]+@/, ":***@"));

await mongoose.connect(uri);
const db = mongoose.connection.db;

const colls = await db.listCollections().toArray();
for (const c of colls) {
  const sample = await db.collection(c.name).findOne({});
  if (!sample) continue;
  const encFields = Object.keys(sample).filter((k) =>
    k.toLowerCase().includes("encrypted"),
  );
  if (encFields.length > 0) {
    const total = await db.collection(c.name).countDocuments({});
    console.log(
      `${c.name}: ${total} docs, encrypted fields: ${encFields.join(", ")}`,
    );
  }
}

await mongoose.disconnect();
process.exit(0);
