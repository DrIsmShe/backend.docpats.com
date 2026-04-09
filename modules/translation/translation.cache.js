import { redis } from "../../common/config/redis.js";

const TTL = 60 * 60 * 24 * 7; // 7 дней

export const getCacheKey = ({ entityId, entityType, language, version }) => {
  return `${entityType}:${entityId}:${language}:v${version}`;
};

export const getFromCache = async (key) => {
  const val = await redis.get(`translation:${key}`);
  return val ? JSON.parse(val) : null;
};

export const setToCache = async (key, value) => {
  await redis.set(`translation:${key}`, JSON.stringify(value), "EX", TTL);
};

export const invalidateCache = async (entityId, entityType) => {
  const keys = await redis.keys(`translation:${entityType}:${entityId}:*`);
  if (keys.length) await redis.del(...keys);
};
