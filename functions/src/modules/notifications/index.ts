import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { sendSMS, sendEmail, sendPush } from "../utils/notifications";

if (!admin.apps.length) {
  admin.initializeApp();
}

const notificationsRef = admin.firestore().collection("notifications");

/**
 * Send notification (stub for email, SMS, push)
 */
export const sendNotification = functions.https.onCall(
  async (data, context) => {
    const {
      userId,
      type,
      title,
      message,
      channel,
      to,
      fcmToken,
      emailSubject,
    } = data.data;
    if (!userId || !type || !title || !message || !channel) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    // Log and store notification (integration with Twilio, Nodemailer, FCM can be added later)
    const now = admin.firestore.FieldValue.serverTimestamp();
    const notificationData = {
      userId,
      type,
      title,
      message,
      channel,
      status: "queued",
      sentAt: null,
      createdAt: now,
    };
    const docRef = await notificationsRef.add(notificationData);
    let sendResult = false;
    if (channel === "sms" && to) {
      sendResult = await sendSMS(to, message);
    } else if (channel === "email" && to) {
      sendResult = await sendEmail(to, emailSubject || title, message);
    } else if (channel === "push" && fcmToken) {
      sendResult = await sendPush(fcmToken, title, message);
    }
    functions.logger.info(
      `Notification sent via ${channel} to user ${userId}: ${sendResult}`
    );
    return { success: true, notificationId: docRef.id };
  }
);
