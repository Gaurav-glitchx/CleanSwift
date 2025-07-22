import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { sendMail } from "../mailer";
import { isValidEmail, generateTempToken } from "../validation";
import { generateOtp, hashOtp } from "../otp";

const pendingAdminsRef = admin.firestore().collection("pendingAdmins");

export const requestAdminPasswordReset = functions.https.onCall(
  async (data: any, _context: any) => {
    const { email } = data.data ? data.data : data;
    if (!email) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Email is required."
      );
    }
    if (!isValidEmail(email)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Invalid email format."
      );
    }
    const providersRef = admin.firestore().collection("providers");
    const snap = await providersRef.where("email", "==", email).limit(1).get();
    if (snap.empty) {
      throw new functions.https.HttpsError(
        "not-found",
        "No admin found with this email."
      );
    }
    const otp = generateOtp();
    const otpHash = hashOtp(otp);
    const expiresAt = Date.now() + 10 * 60 * 1000;
    const tempToken = generateTempToken();
    const tempTokenExpiresAt = Date.now() + 15 * 60 * 1000;
    await pendingAdminsRef.doc(email).set(
      {
        otpHash,
        expiresAt,
        passwordReset: true,
        createdAt: Date.now(),
        tempToken,
        tempTokenExpiresAt,
      },
      { merge: true }
    );
    const adminData = snap.docs[0].data();
    const businessName = adminData?.businessName || "Your Business";
    await sendMail({
      to: email,
      subject: `Your Password Reset OTP for ${businessName}`,
      text: `Your OTP for password reset on ${businessName} is: ${otp}`,
      html: `<p>Your OTP for password reset on <b>${businessName}</b> is: <b>${otp}</b></p>`,
    });
    return {
      success: true,
      message: "Password reset OTP sent to email.",
      tempToken,
    };
  }
);

export const verifyAdminPasswordResetOtp = functions.https.onCall(
  async (data: any, _context: any) => {
    const { tempToken, otp } = data.data ? data.data : data;
    if (!tempToken || !otp) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing temp token or OTP."
      );
    }
    const snap = await pendingAdminsRef
      .where("tempToken", "==", tempToken)
      .limit(1)
      .get();
    if (snap.empty) {
      throw new functions.https.HttpsError(
        "not-found",
        "Invalid or expired temp token."
      );
    }
    const docRef = snap.docs[0].ref;
    const pending = snap.docs[0].data();
    if (!pending || !pending.passwordReset) {
      throw new functions.https.HttpsError(
        "not-found",
        "No password reset request found for this token."
      );
    }
    if (
      Date.now() > pending.expiresAt ||
      Date.now() > pending.tempTokenExpiresAt
    ) {
      throw new functions.https.HttpsError(
        "deadline-exceeded",
        "OTP or temp token expired."
      );
    }
    const otpHash = hashOtp(otp);
    if (otpHash !== pending.otpHash) {
      throw new functions.https.HttpsError("invalid-argument", "Invalid OTP.");
    }
    await docRef.update({ otpVerified: true });
    return {
      success: true,
      message: "OTP verified. You can now reset your password.",
    };
  }
);

export const resetAdminPassword = functions.https.onCall(
  async (data: any, _context: any) => {
    const { tempToken, newPassword } = data.data ? data.data : data;
    if (!tempToken || !newPassword) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing temp token or new password."
      );
    }
    const snap = await pendingAdminsRef
      .where("tempToken", "==", tempToken)
      .limit(1)
      .get();
    if (snap.empty) {
      throw new functions.https.HttpsError(
        "not-found",
        "Invalid or expired temp token."
      );
    }
    const docRef = snap.docs[0].ref;
    const pending = snap.docs[0].data();
    if (!pending || !pending.passwordReset || !pending.otpVerified) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "OTP verification required before resetting password."
      );
    }
    const newPasswordHash = hashOtp(newPassword);
    await docRef.update({
      passwordHash: newPasswordHash,
      passwordReset: false,
      otpVerified: false,
      tempToken: admin.firestore.FieldValue.delete(),
      tempTokenExpiresAt: admin.firestore.FieldValue.delete(),
    });
    return { success: true, message: "Password has been reset successfully." };
  }
);

export const changeAdminPassword = functions.https.onCall(
  async (data: any, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { oldPassword, newPassword } = data.data ? data.data : data;
    if (!oldPassword || !newPassword) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Old and new passwords are required."
      );
    }
    const adminId = context.auth.uid;
    const providersRef = admin.firestore().collection("providers");
    const adminDoc = await providersRef.doc(adminId).get();
    if (!adminDoc.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "Admin profile not found."
      );
    }
    const adminData = adminDoc.data();
    if (!adminData || !adminData.email) {
      throw new functions.https.HttpsError(
        "not-found",
        "Admin email not found."
      );
    }
    const email = adminData.email;
    const pendingDoc = await pendingAdminsRef.doc(email).get();
    const pending = pendingDoc.data();
    if (!pending || !pending.passwordHash) {
      throw new functions.https.HttpsError(
        "not-found",
        "No password set for this admin."
      );
    }
    const passwordHash = pending.passwordHash;
    const oldHash = hashOtp(oldPassword);
    if (oldHash !== passwordHash) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Old password is incorrect."
      );
    }
    const newHash = hashOtp(newPassword);
    await pendingAdminsRef.doc(email).update({ passwordHash: newHash });
    return { success: true, message: "Password changed successfully." };
  }
);
