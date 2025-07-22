import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { hashOtp } from "../otp";
import { auditLog } from "../../utils";

const pendingAdminsRef = admin.firestore().collection("pendingAdmins");

export const loginAdmin = functions.https.onCall(async (data: any, context) => {
  const { email, password, deviceInfo, sessionDurationMinutes } = data.data
    ? data.data
    : data;
  if (!email || !password) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Email and password are required."
    );
  }
  // Find the admin profile in providers
  const providersRef = admin.firestore().collection("providers");
  const snap = await providersRef.where("email", "==", email).limit(1).get();
  if (snap.empty) {
    throw new functions.https.HttpsError(
      "not-found",
      "No admin found with this email."
    );
  }
  const adminDoc = snap.docs[0];
  const adminData = adminDoc.data();
  // Get the password hash from pendingAdmins (since providers does not store it)
  const pendingDoc = await pendingAdminsRef.doc(email).get();
  const pending = pendingDoc.data();
  if (!pending || !pending.passwordHash) {
    throw new functions.https.HttpsError(
      "not-found",
      "No password set for this admin. Please register or reset your password."
    );
  }
  const passwordHash = pending.passwordHash;
  const inputHash = hashOtp(password);
  if (inputHash !== passwordHash) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Invalid password."
    );
  }
  // Create a session
  const now = admin.firestore.FieldValue.serverTimestamp();
  const expiresAt = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() + (sessionDurationMinutes || 60) * 60000)
  );
  const sessionData = {
    userId: adminDoc.id,
    isAdmin: true,
    deviceInfo: deviceInfo || {},
    status: "active",
    lastActivity: now,
    createdAt: now,
    expiresAt,
  };
  const docRef = await admin
    .firestore()
    .collection("adminSessions")
    .add(sessionData);
  await auditLog({
    userId: adminDoc.id,
    action: "admin_login",
    details: { sessionId: docRef.id, deviceInfo },
    context: { ip: deviceInfo?.ipAddress },
  });
  return {
    success: true,
    sessionId: docRef.id,
    expiresAt,
    adminId: adminDoc.id,
    businessName: adminData?.businessName || "",
  };
});
