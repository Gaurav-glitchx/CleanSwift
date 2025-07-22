import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

export const placeholder = () => "utils module";

/**
 * Check if a point is within a circle (geofence)
 * @param {object} point { latitude, longitude }
 * @param {object} center { latitude, longitude }
 * @param {number} radius Radius in kilometers
 * @returns {boolean}
 */
export function isPointInCircle(
  point: { latitude: number; longitude: number },
  center: { latitude: number; longitude: number },
  radius: number
): boolean {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const R = 6371; // Earth radius in km
  const dLat = toRad(center.latitude - point.latitude);
  const dLon = toRad(center.longitude - point.longitude);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(point.latitude)) *
      Math.cos(toRad(center.latitude)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c;
  return d <= radius;
}

/**
 * Log a sensitive action to the auditLogs collection
 */
export async function auditLog({
  userId,
  action,
  details,
  context,
}: {
  userId: string;
  action: string;
  details?: any;
  context?: any;
}) {
  const now = Date.now();
  await admin
    .firestore()
    .collection("auditLogs")
    .add({
      userId,
      action,
      details: details || {},
      context: context || {},
      timestamp: now,
    });
}

/**
 * Firestore-based rate limiter
 * Throws if limit exceeded
 */
export async function rateLimit(
  userId: string,
  action: string,
  limit: number,
  windowSeconds: number
) {
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;
  const ref = admin
    .firestore()
    .collection("rateLimits")
    .doc(`${userId}_${action}`);
  const doc = await ref.get();
  let data = doc.exists && doc.data() ? doc.data() : { timestamps: [] };
  if (!data) data = { timestamps: [] };
  // Remove old timestamps
  data.timestamps = (data.timestamps || []).filter(
    (t: number) => t > windowStart
  );
  if (data.timestamps.length >= limit) {
    throw new Error("Rate limit exceeded. Please try again later.");
  }
  data.timestamps.push(now);
  await ref.set(data);
}

/**
 * Generate a signed upload URL for Firebase Storage
 */
export const getSignedUploadUrl = functions.https.onCall(
  async (data, context) => {
    const { filePath, contentType } = data.data;
    // @ts-ignore
    if (!context.auth || !filePath || !contentType) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required and filePath/contentType required."
      );
    }
    const bucket = admin.storage().bucket();
    const file = bucket.file(filePath);
    const [url] = await file.getSignedUrl({
      action: "write",
      expires: Date.now() + 10 * 60 * 1000, // 10 minutes
      contentType,
    });
    return { success: true, url };
  }
);
