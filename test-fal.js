// server/test-fal.js
const FAL_KEY = process.env.FAL_KEY;

try {
  const res = await fetch("https://queue.fal.run/fal-ai/flux-pro/v1/fill", {
    method: "POST",
    headers: {
      Authorization: `Key ${FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ test: true }),
  });
  console.log("Status:", res.status);
  console.log("Response:", await res.text());
} catch (err) {
  console.error("Ошибка:", err.message);
  console.error("Cause:", err.cause);
}
