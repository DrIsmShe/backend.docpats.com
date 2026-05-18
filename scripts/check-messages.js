import "dotenv/config";
import mongoose from "mongoose";

await mongoose.connect(process.env.MONGO_URL);
const db = mongoose.connection.db;
const coll = db.collection("messages");

const total = await coll.countDocuments({});
const encrypted = await coll.countDocuments({
  textEncrypted: { $exists: true, $nin: [null, ""] },
});
console.log("Total messages:", total);
console.log("With textEncrypted:", encrypted);

const all = await coll
  .find({ textEncrypted: { $exists: true, $nin: [null, ""] } })
  .project({ textEncrypted: 1 })
  .toArray();

let gcm = 0;
let cbc = 0;
let other = 0;
all.forEach((d) => {
  const parts = d.textEncrypted?.split(":").length;
  if (parts === 3) gcm++;
  else if (parts === 2) cbc++;
  else other++;
});

console.log(`Format breakdown: GCM=${gcm}, CBC=${cbc}, other=${other}`);

await mongoose.disconnect();
