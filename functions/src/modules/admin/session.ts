// session.ts - Session helpers for admin module
import * as admin from "firebase-admin";
import * as functions from "firebase-functions";

export async function validateAdminSession(sessionId: string, userId: string) {
  if (!sessionId) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Session ID required."
    );
  }
  if (!userId) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "User authentication required."
    );
  }
  const sessionDoc = await admin
    .firestore()
    .collection("adminSessions")
    .doc(sessionId)
    .get();
  const session = sessionDoc.data();
  if (
    !session ||
    session.status !== "active" ||
    (session.expiresAt && Date.now() > session.expiresAt.toMillis())
  ) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Session invalid or expired."
    );
  }
  if (session.userId !== userId) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Session does not belong to the authenticated user."
    );
  }
  return session;
}
