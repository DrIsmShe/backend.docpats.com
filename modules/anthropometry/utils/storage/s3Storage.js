import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner";
import { isValidStorageKey } from "./storageKeys.js";

const ENDPOINT = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const BUCKET = process.env.R2_BUCKET;
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
const PUBLIC_URL = process.env.R2_PUBLIC_URL;
const DEFAULT_TTL = parseInt(process.env.S3_SIGNED_URL_TTL || "3600", 10);

if (process.env.NODE_ENV !== "test" && process.env.STORAGE_DRIVER === "s3") {
  if (!process.env.R2_ACCOUNT_ID || !ACCESS_KEY || !SECRET_KEY || !BUCKET) {
    console.error(
      "[s3Storage] Missing required env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET",
    );
  }
}

const client = new S3Client({
  endpoint: ENDPOINT,
  region: "auto",
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  },
});

export const upload = async (buffer, options) => {
  const { storageKey, contentType, metadata } = options;

  if (!Buffer.isBuffer(buffer)) {
    throw new Error("upload requires a Buffer");
  }
  if (!isValidStorageKey(storageKey)) {
    throw new Error(`Invalid storage key: ${storageKey}`);
  }

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: storageKey,
      Body: buffer,
      ContentType: contentType || "application/octet-stream",
      Metadata: metadata || undefined,
    }),
  );

  return {
    storageKey,
    size: buffer.length,
    contentType: contentType || "application/octet-stream",
  };
};

export const remove = async (storageKey) => {
  if (!isValidStorageKey(storageKey)) {
    throw new Error(`Invalid storage key: ${storageKey}`);
  }
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: storageKey,
      }),
    );
    return true;
  } catch (err) {
    if (err.name === "NoSuchKey") return false;
    throw err;
  }
};

export const exists = async (storageKey) => {
  if (!isValidStorageKey(storageKey)) {
    throw new Error(`Invalid storage key: ${storageKey}`);
  }
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: BUCKET,
        Key: storageKey,
      }),
    );
    return true;
  } catch (err) {
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
};

export const getMetadata = async (storageKey) => {
  if (!isValidStorageKey(storageKey)) {
    throw new Error(`Invalid storage key: ${storageKey}`);
  }
  try {
    const head = await client.send(
      new HeadObjectCommand({
        Bucket: BUCKET,
        Key: storageKey,
      }),
    );
    return {
      size: head.ContentLength,
      lastModified: head.LastModified,
      contentType: head.ContentType,
      etag: head.ETag,
      customMetadata: head.Metadata || {},
    };
  } catch (err) {
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw err;
  }
};

export const getSignedUrl = async (storageKey, ttlSeconds = DEFAULT_TTL) => {
  if (!isValidStorageKey(storageKey)) {
    throw new Error(`Invalid storage key: ${storageKey}`);
  }
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
  });
  return awsGetSignedUrl(client, command, { expiresIn: ttlSeconds });
};

export const getPublicUrl = (storageKey) => {
  if (!isValidStorageKey(storageKey)) {
    throw new Error(`Invalid storage key: ${storageKey}`);
  }
  if (!PUBLIC_URL) {
    throw new Error("R2_PUBLIC_URL is not set — cannot generate public URL");
  }
  return `${PUBLIC_URL}/${storageKey}`;
};

export const read = async (storageKey) => {
  if (!isValidStorageKey(storageKey)) {
    throw new Error(`Invalid storage key: ${storageKey}`);
  }
  const result = await client.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: storageKey,
    }),
  );
  const chunks = [];
  for await (const chunk of result.Body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

export const listByPrefix = async (prefix, options = {}) => {
  const { maxKeys = 1000 } = options;
  const result = await client.send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      MaxKeys: maxKeys,
    }),
  );
  return (result.Contents || []).map((obj) => ({
    storageKey: obj.Key,
    size: obj.Size,
    lastModified: obj.LastModified,
  }));
};

export const healthCheck = async () => {
  try {
    await client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        MaxKeys: 1,
      }),
    );
    return {
      ok: true,
      driver: "s3",
      bucket: BUCKET,
      endpoint: ENDPOINT,
    };
  } catch (err) {
    return {
      ok: false,
      driver: "s3",
      bucket: BUCKET,
      error: err.message,
    };
  }
};

export default {
  upload,
  remove,
  exists,
  getMetadata,
  getSignedUrl,
  getPublicUrl,
  read,
  listByPrefix,
  healthCheck,
  driver: "s3",
};
