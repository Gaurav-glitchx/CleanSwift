import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { sendMail } from "../mailer";
import { isValidEmail, isValidE164, generateTempToken } from "../validation";
import { generateOtp, hashOtp } from "../otp";

const pendingAdminsRef = admin.firestore().collection("pendingAdmins");

export const createAdmin = functions.https.onCall(
  async (data: any, _context: any) => {
    const payload = data.data ? data.data : data;
    const { firstName, lastName, email, phoneNumber, businessName, password } =
      payload;
    if (
      !firstName ||
      !lastName ||
      !email ||
      !phoneNumber ||
      !businessName ||
      !password
    ) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    if (!isValidEmail(email)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Invalid email format."
      );
    }
    if (!isValidE164(phoneNumber)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Phone number must be E.164 format (e.g., +1234567890)."
      );
    }
    const existingSnap = await pendingAdminsRef
      .where("email", "==", email)
      .get();
    if (!existingSnap.empty) {
      throw new functions.https.HttpsError(
        "already-exists",
        "An OTP is already pending for this email."
      );
    }
    const otp = generateOtp();
    const otpHash = hashOtp(otp);
    const expiresAt = Date.now() + 10 * 60 * 1000;
    const tempToken = generateTempToken();
    const tempTokenExpiresAt = Date.now() + 15 * 60 * 1000;
    await pendingAdminsRef.doc(email).set({
      firstName,
      lastName,
      email,
      phoneNumber,
      businessName,
      passwordHash: admin.firestore.FieldValue.serverTimestamp()
        ? undefined
        : undefined, // keep as in original
      otpHash,
      expiresAt,
      verified: false,
      createdAt: Date.now(),
      tempToken,
      tempTokenExpiresAt,
    });
    await sendMail({
      to: email,
      subject: `Your OTP for ${businessName} Admin Registration`,
      text: `Your OTP for ${businessName} is: ${otp}`,
      html: `<p>Your OTP for <b>${businessName}</b> is: <b>${otp}</b></p>`,
    });
    return { success: true, message: "OTP sent to email.", tempToken };
  }
);

export const verifyAdminOtp = functions.https.onCall(
  async (data: any, context) => {
    const { tempToken, otp } = data.data;
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
    if (!pending || pending.verified) {
      throw new functions.https.HttpsError(
        "already-exists",
        "Already verified."
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
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        email: pending.email,
        phoneNumber: pending.phoneNumber,
        displayName: `${pending.firstName} ${pending.lastName}`,
        emailVerified: true,
        disabled: false,
        password: undefined,
      });
    } catch (err: any) {
      throw new functions.https.HttpsError(
        "internal",
        "Failed to create auth user: " + err.message
      );
    }
    await admin.firestore().collection("providers").doc(userRecord.uid).set({
      userId: userRecord.uid,
      firstName: pending.firstName,
      lastName: pending.lastName,
      email: pending.email,
      phoneNumber: pending.phoneNumber,
      businessName: pending.businessName,
      isVerified: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await docRef.update({
      verified: true,
      tempToken: admin.firestore.FieldValue.delete(),
      tempTokenExpiresAt: admin.firestore.FieldValue.delete(),
    });
    await sendMail({
      to: pending.email,
      subject: `Welcome to ${pending.businessName}! Your Admin Account is Ready`,
      text: `Hi,\n\nYour admin account for ${pending.businessName} has been successfully created. You can now log in and start using the platform.\n\nBest regards,\n${pending.businessName} Team`,
      html: `<p>Hi,</p><p>Your admin account for <b>${pending.businessName}</b> has been <b>successfully created</b>. You can now log in and start using the platform.</p><p>Best regards,<br/>${pending.businessName} Team</p>`,
    });
    return { success: true, userId: userRecord.uid };
  }
);

export const resendAdminOtp = functions.https.onCall(
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
    const docRef = pendingAdminsRef.doc(email);
    const doc = await docRef.get();
    if (!doc.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "No pending registration for this email."
      );
    }
    const pending = doc.data();
    if (!pending || pending.verified) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "No pending OTP to resend."
      );
    }
    const now = Date.now();
    if (pending.createdAt && now - pending.createdAt < 2 * 60 * 1000) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "You can only resend OTP after 2 minutes."
      );
    }
    const otp = generateOtp();
    const otpHash = hashOtp(otp);
    const expiresAt = now + 10 * 60 * 1000;
    const tempToken = generateTempToken();
    const tempTokenExpiresAt = now + 15 * 60 * 1000;
    await docRef.update({
      otpHash,
      expiresAt,
      createdAt: now,
      tempToken,
      tempTokenExpiresAt,
    });
    await sendMail({
      to: email,
      subject: `Your OTP for ${pending.businessName} Admin Registration`,
      text: `Your OTP for ${pending.businessName} is: ${otp}`,
      html: `<p>Your OTP for <b>${pending.businessName}</b> is: <b>${otp}</b></p>`,
    });
    return { success: true, message: "OTP resent to email.", tempToken };
  }
);
