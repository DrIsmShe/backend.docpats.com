const URL =
  process.env.SITEMAP_INVALIDATE_URL ||
  `http://localhost:${process.env.PORT || 11000}/api/sitemap/invalidate`;

export async function invalidateSitemapOnPublish() {
  try {
    await fetch(URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sitemap-secret": process.env.SITEMAP_SECRET || "",
      },
      body: JSON.stringify({ secret: process.env.SITEMAP_SECRET }),
    });
  } catch (err) {
    console.warn("[sitemap] invalidate:", err.message);
  }
}
