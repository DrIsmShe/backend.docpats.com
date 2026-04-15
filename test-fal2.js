const FAL_KEY =
  "f4232e7c-7c5b-4e99-bba7-43b2c7d3c17b:ebdeaac58736fa2de15f721aeb16b2e3";

const res = await fetch("https://queue.fal.run/fal-ai/flux-pro/v1/fill", {
  method: "POST",
  headers: {
    Authorization: "Key " + FAL_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ prompt: "test" }),
});

console.log("Status:", res.status);
console.log(await res.text());
