// test-storage.mjs
import "dotenv/config";
import storage, { keys } from "./modules/anthropometry/utils/storage/index.js";

console.log("Driver:", storage.driver);

// Health check
const health = await storage.healthCheck();
console.log("Health:", health);
if (!health.ok) {
  console.error("Storage health check failed");
  process.exit(1);
}

// Upload test
const testBuffer = Buffer.from("Hello R2 from anthropometry module!");
const testKey = keys.photoKey({
  caseId: "test-case",
  studyId: "test-study",
  photoId: "test-photo-" + Date.now(),
  extension: "txt",
});

console.log("Uploading to:", testKey);
const uploadResult = await storage.upload(testBuffer, {
  storageKey: testKey,
  contentType: "text/plain",
  metadata: { test: "true" },
});
console.log("Upload OK:", uploadResult);

// Exists
const exists = await storage.exists(testKey);
console.log("Exists:", exists);

// Metadata
const meta = await storage.getMetadata(testKey);
console.log("Metadata:", meta);

// Signed URL
const url = await storage.getSignedUrl(testKey, 60);
console.log("Signed URL (60s):", url);

// Cleanup
const removed = await storage.remove(testKey);
console.log("Removed:", removed);

console.log("\nAll storage operations OK");
