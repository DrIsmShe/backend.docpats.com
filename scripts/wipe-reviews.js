// scripts/wipe-reviews.js — одноразовая очистка clinic_reviews
import "dotenv/config";
import mongoose from "mongoose";

const uri =
  process.env.MONGO_URL ||
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  process.env.DB_URI;

if (!uri) {
  console.error("No Mongo URI env var found");
  process.exit(1);
}

await mongoose.connect(uri);
console.log("connected to:", mongoose.connection.name);
const res = await mongoose.connection.db
  .collection("clinic_reviews")
  .deleteMany({});
console.log("deleted clinic_reviews:", res.deletedCount);
await mongoose.disconnect();
process.exit(0);
