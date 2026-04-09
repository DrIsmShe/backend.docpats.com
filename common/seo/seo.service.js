import axios from "axios";

const SITEMAP_URL = "https://docpats.com/sitemap.xml";

let lastPing = 0;

export const pingSearchEngines = async () => {
  if (Date.now() - lastPing < 1000 * 60 * 5) return; // раз в 5 минут

  lastPing = Date.now();

  try {
    const urls = [
      `https://www.google.com/ping?sitemap=${SITEMAP_URL}`,
      `https://www.bing.com/ping?sitemap=${SITEMAP_URL}`,
    ];

    await Promise.all(urls.map((url) => axios.get(url)));

    console.log("✅ Search engines pinged");
  } catch (error) {
    console.error("❌ Ping error:", error.message);
  }
};
