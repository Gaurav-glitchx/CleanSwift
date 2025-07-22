import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { auditLog } from "../utils";
import * as crypto from "crypto";
import * as nodemailer from "nodemailer";

const pendingAdminsRef = admin.firestore().collection("pendingAdmins");

function generateTempToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Admin Onboarding: Step 1 - Register and send OTP
 */
export const createAdmin = functions.https.onCall(
  async (data: any, _context: any) => {
    // Accept both {firstName, ...} and {data: {firstName, ...}}
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
    // Optionally, add password strength validation here

    // Check for duplicate email
    const existingSnap = await pendingAdminsRef
      .where("email", "==", email)
      .get();
    if (!existingSnap.empty) {
      throw new functions.https.HttpsError(
        "already-exists",
        "An OTP is already pending for this email."
      );
    }

    // Generate OTP and temp token
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
    const tempToken = generateTempToken();
    const tempTokenExpiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

    // Store pending admin with hashed password and OTP
    await pendingAdminsRef.doc(email).set({
      firstName,
      lastName,
      email,
      phoneNumber,
      businessName,
      passwordHash: crypto.createHash("sha256").update(password).digest("hex"),
      otpHash,
      expiresAt,
      verified: false,
      createdAt: Date.now(),
      tempToken,
      tempTokenExpiresAt,
    });

    // Send OTP to email using nodemailer
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: Number(process.env.SMTP_PORT) === 465, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: email,
      subject: `Your OTP for ${businessName} Admin Registration`,
      text: `Your OTP for ${businessName} is: ${otp}`,
      html: `<p>Your OTP for <b>${businessName}</b> is: <b>${otp}</b></p>`,
    });

    return { success: true, message: "OTP sent to email.", tempToken };
  }
);

/**
 * Admin Onboarding: Step 2 - Verify OTP and create user
 */
export const verifyAdminOtp = functions.https.onCall(
  async (data: any, context) => {
    const { tempToken, otp } = data.data;
    if (!tempToken || !otp) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing temp token or OTP."
      );
    }
    // Find pending admin by tempToken
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
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    if (otpHash !== pending.otpHash) {
      throw new functions.https.HttpsError("invalid-argument", "Invalid OTP.");
    }
    // Create Firebase Auth user
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        email: pending.email,
        phoneNumber: pending.phoneNumber,
        displayName: `${pending.firstName} ${pending.lastName}`,
        emailVerified: true,
        disabled: false,
        password: undefined, // Not storing password in Auth, only for demo
      });
    } catch (err: any) {
      throw new functions.https.HttpsError(
        "internal",
        "Failed to create auth user: " + err.message
      );
    }
    // Store admin profile in Firestore
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
    // Mark as verified and invalidate tempToken
    await docRef.update({
      verified: true,
      tempToken: admin.firestore.FieldValue.delete(),
      tempTokenExpiresAt: admin.firestore.FieldValue.delete(),
    });

    // Send onboarding email
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    await transporter.sendMail({
      from: process.env.SMTP_USER,
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
    // Only allow resend if at least 2 minutes have passed since last OTP
    if (pending.createdAt && now - pending.createdAt < 2 * 60 * 1000) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "You can only resend OTP after 2 minutes."
      );
    }
    // Generate new OTP and temp token
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    const expiresAt = now + 10 * 60 * 1000; // 10 minutes
    const tempToken = generateTempToken();
    const tempTokenExpiresAt = now + 15 * 60 * 1000; // 15 minutes
    // Update Firestore
    await docRef.update({
      otpHash,
      expiresAt,
      createdAt: now,
      tempToken,
      tempTokenExpiresAt,
    });
    // Send OTP to email
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: email,
      subject: `Your OTP for ${pending.businessName} Admin Registration`,
      text: `Your OTP for ${pending.businessName} is: ${otp}`,
      html: `<p>Your OTP for <b>${pending.businessName}</b> is: <b>${otp}</b></p>`,
    });
    return { success: true, message: "OTP resent to email.", tempToken };
  }
);

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
  const inputHash = crypto.createHash("sha256").update(password).digest("hex");
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

/**
 * Admin Onboarding: Step 3 - Request Password Reset
 */
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
    // Check if admin exists and is verified
    const providersRef = admin.firestore().collection("providers");
    const snap = await providersRef.where("email", "==", email).limit(1).get();
    if (snap.empty) {
      throw new functions.https.HttpsError(
        "not-found",
        "No admin found with this email."
      );
    }
    // Generate OTP and temp token
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
    const tempToken = generateTempToken();
    const tempTokenExpiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes
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
    // Get businessName for email
    const adminData = snap.docs[0].data();
    const businessName = adminData?.businessName || "Your Business";
    // Send OTP to email
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    await transporter.sendMail({
      from: process.env.SMTP_USER,
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

/**
 * Admin Onboarding: Step 4 - Verify Password Reset OTP
 */
export const verifyAdminPasswordResetOtp = functions.https.onCall(
  async (data: any, _context: any) => {
    const { tempToken, otp } = data.data ? data.data : data;
    if (!tempToken || !otp) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing temp token or OTP."
      );
    }
    // Find pending admin by tempToken
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
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    if (otpHash !== pending.otpHash) {
      throw new functions.https.HttpsError("invalid-argument", "Invalid OTP.");
    }
    // Set otpVerified flag
    await docRef.update({ otpVerified: true });
    return {
      success: true,
      message: "OTP verified. You can now reset your password.",
    };
  }
);

/**
 * Admin Onboarding: Step 5 - Reset Password
 */
export const resetAdminPassword = functions.https.onCall(
  async (data: any, _context: any) => {
    const { tempToken, newPassword } = data.data ? data.data : data;
    if (!tempToken || !newPassword) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing temp token or new password."
      );
    }
    // Find pending admin by tempToken
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
    // Update password hash and clear flags
    const newPasswordHash = crypto
      .createHash("sha256")
      .update(newPassword)
      .digest("hex");
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
    // Get admin's email from providers collection
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
    // Get password hash from pendingAdmins
    const pendingDoc = await pendingAdminsRef.doc(email).get();
    const pending = pendingDoc.data();
    if (!pending || !pending.passwordHash) {
      throw new functions.https.HttpsError(
        "not-found",
        "No password set for this admin."
      );
    }
    const passwordHash = pending.passwordHash;
    const oldHash = crypto
      .createHash("sha256")
      .update(oldPassword)
      .digest("hex");
    if (oldHash !== passwordHash) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Old password is incorrect."
      );
    }
    // Update password hash
    const newHash = crypto
      .createHash("sha256")
      .update(newPassword)
      .digest("hex");
    await pendingAdminsRef.doc(email).update({ passwordHash: newHash });
    return { success: true, message: "Password changed successfully." };
  }
);

// Update validateAdminSession to require userId and ensure session belongs to the authenticated user
async function validateAdminSession(sessionId: string, userId: string) {
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

const workingHoursRef = admin.firestore().collection("workingHours");

/**
 * Create working hours for a provider
 */
/**
 * @param {functions.https.CallableContext} context
 */
export const createWorkingHours = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, providerId, ...hours } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Provider ID required."
      );
    }
    // Prevent duplicate working hours for the same provider (optional)
    const dupSnap = await workingHoursRef
      .where("providerId", "==", providerId)
      .where("isDeleted", "==", false)
      .get();
    if (!dupSnap.empty) {
      throw new functions.https.HttpsError(
        "already-exists",
        "Working hours already exist for this provider."
      );
    }
    const now = Date.now();
    const workingHoursData = {
      providerId,
      ...hours,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    };
    const docRef = await workingHoursRef.add(workingHoursData);
    return { success: true, hoursId: docRef.id };
  }
);

/**
 * Update working hours
 */
/**
 * @param {functions.https.CallableContext} context
 */
export const updateWorkingHours = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, hoursId, providerId, ...updates } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId || !hoursId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    const docRef = workingHoursRef.doc(hoursId);
    const doc = await docRef.get();
    if (!doc.exists || doc.data()?.providerId !== providerId) {
      throw new functions.https.HttpsError(
        "not-found",
        "Working hours not found."
      );
    }
    updates.updatedAt = Date.now();
    await docRef.update(updates);
    return { success: true };
  }
);

/**
 * Soft delete working hours
 */
/**
 * @param {functions.https.CallableContext} context
 */
export const deleteWorkingHours = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, hoursId, providerId } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId || !hoursId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    const docRef = workingHoursRef.doc(hoursId);
    const doc = await docRef.get();
    if (!doc.exists || doc.data()?.providerId !== providerId) {
      throw new functions.https.HttpsError(
        "not-found",
        "Working hours not found."
      );
    }
    await docRef.update({
      isDeleted: true,
      updatedAt: Date.now(),
    });
    return { success: true };
  }
);

/**
 * List all active (not deleted) working hours for a provider
 */
/**
 * @param {functions.https.CallableContext} context
 */
export const listWorkingHours = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, providerId } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const snap = await workingHoursRef
      .where("providerId", "==", providerId)
      .where("isDeleted", "==", false)
      .get();
    const workingHours = snap.docs.map((doc) => ({
      hoursId: doc.id,
      ...doc.data(),
    }));
    return { success: true, workingHours };
  }
);

const serviceableAreasRef = admin.firestore().collection("serviceableAreas");

/**
 * Create a serviceable area for a provider
 */
/**
 * @param {functions.https.CallableContext} context
 */
export const createServiceableArea = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, providerId, name, center, radius, workingHoursId } =
      data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId || !name || !center || !radius) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    // Prevent duplicate area name for the same provider
    const dupSnap = await serviceableAreasRef
      .where("providerId", "==", providerId)
      .where("name", "==", name)
      .where("isDeleted", "==", false)
      .get();
    if (!dupSnap.empty) {
      throw new functions.https.HttpsError(
        "already-exists",
        "Area name already exists for this provider."
      );
    }
    const now = Date.now();
    const areaData = {
      providerId,
      name,
      center,
      radius,
      workingHoursId: workingHoursId || null,
      isActive: true,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    };
    const docRef = await serviceableAreasRef.add(areaData);
    return { success: true, areaId: docRef.id };
  }
);

/**
 * Update a serviceable area
 */
/**
 * @param {functions.https.CallableContext} context
 */
export const updateServiceableArea = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, areaId, providerId, ...updates } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId || !areaId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    const docRef = serviceableAreasRef.doc(areaId);
    const doc = await docRef.get();
    if (!doc.exists || doc.data()?.providerId !== providerId) {
      throw new functions.https.HttpsError(
        "not-found",
        "Serviceable area not found."
      );
    }
    updates.updatedAt = Date.now();
    await docRef.update(updates);
    return { success: true };
  }
);

/**
 * Soft delete a serviceable area
 */
/**
 * @param {functions.https.CallableContext} context
 */
export const deleteServiceableArea = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, areaId, providerId } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId || !areaId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    const docRef = serviceableAreasRef.doc(areaId);
    const doc = await docRef.get();
    if (!doc.exists || doc.data()?.providerId !== providerId) {
      throw new functions.https.HttpsError(
        "not-found",
        "Serviceable area not found."
      );
    }
    await docRef.update({
      isDeleted: true,
      updatedAt: Date.now(),
    });
    return { success: true };
  }
);

/**
 * List all active (not deleted) serviceable areas for a provider
 */
/**
 * @param {functions.https.CallableContext} context
 */
export const listServiceableAreas = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, providerId } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const snap = await serviceableAreasRef
      .where("providerId", "==", providerId)
      .where("isDeleted", "==", false)
      .get();
    const areas = snap.docs.map((doc) => ({ areaId: doc.id, ...doc.data() }));
    return { success: true, areas };
  }
);

const staffRef = admin.firestore().collection("staff");

/**
 * Create a staff/agent for a provider
 */
/**
 * @param {functions.https.CallableContext} context
 */
export const createStaff = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, providerId, name, email, phone, role, isActive } =
      data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId || !name || !email || !phone || !role) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    // Prevent duplicate email for the same provider
    const dupSnap = await staffRef
      .where("providerId", "==", providerId)
      .where("email", "==", email)
      .where("isDeleted", "==", false)
      .get();
    if (!dupSnap.empty) {
      throw new functions.https.HttpsError(
        "already-exists",
        "Staff email already exists for this provider."
      );
    }
    const now = Date.now();
    const staffData = {
      providerId,
      name,
      email,
      phone,
      role,
      isActive: isActive !== false,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    };
    const docRef = await staffRef.add(staffData);
    return { success: true, staffId: docRef.id };
  }
);

/**
 * Update a staff/agent
 */
/**
 * @param {functions.https.CallableContext} context
 */
export const updateStaff = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, staffId, providerId, ...updates } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId || !staffId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    const docRef = staffRef.doc(staffId);
    const doc = await docRef.get();
    if (!doc.exists || doc.data()?.providerId !== providerId) {
      throw new functions.https.HttpsError("not-found", "Staff not found.");
    }
    updates.updatedAt = Date.now();
    await docRef.update(updates);
    return { success: true };
  }
);

/**
 * Soft delete a staff/agent
 */
/**
 * @param {functions.https.CallableContext} context
 */
export const deleteStaff = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, staffId, providerId } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId || !staffId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    const docRef = staffRef.doc(staffId);
    const doc = await docRef.get();
    if (!doc.exists || doc.data()?.providerId !== providerId) {
      throw new functions.https.HttpsError("not-found", "Staff not found.");
    }
    await docRef.update({
      isDeleted: true,
      updatedAt: Date.now(),
    });
    return { success: true };
  }
);

/**
 * List all active (not deleted) staff/agents for a provider
 */
/**
 * @param {functions.https.CallableContext} context
 */
export const listStaff = functions.https.onCall(async (data, context: any) => {
  if (!context || !context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required."
    );
  }
  const { sessionId, providerId } = data.data;
  await validateAdminSession(sessionId, context.auth.uid);
  if (!providerId) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required."
    );
  }
  const snap = await staffRef
    .where("providerId", "==", providerId)
    .where("isDeleted", "==", false)
    .get();
  const staff = snap.docs.map((doc) => ({ staffId: doc.id, ...doc.data() }));
  return { success: true, staff };
});

/**
 * Get analytics/KPIs for a provider dashboard
 */
/**
 * @param {functions.https.CallableContext} context
 */
export const getProviderAnalytics = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, providerId, startDate, endDate } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    // Date range filter
    let orderQuery = admin
      .firestore()
      .collection("orders")
      .where("providerId", "==", providerId);
    if (startDate)
      orderQuery = orderQuery.where("createdAt", ">=", new Date(startDate));
    if (endDate)
      orderQuery = orderQuery.where("createdAt", "<=", new Date(endDate));
    const ordersSnap = await orderQuery.get();
    const orders = ordersSnap.docs.map((doc) => doc.data());
    // Revenue and order count
    const totalRevenue = orders.reduce(
      (sum, o) => sum + (o.payment?.status === "paid" ? o.totalAmount || 0 : 0),
      0
    );
    const orderCount = orders.length;
    // Active customers
    const uniqueUsers = new Set(orders.map((o) => o.userId));
    const activeCustomers = uniqueUsers.size;
    // Top services
    const serviceCounts: Record<string, number> = {};
    orders.forEach((o) => {
      (o.items || []).forEach((item: any) => {
        if (!serviceCounts[item.serviceId]) serviceCounts[item.serviceId] = 0;
        serviceCounts[item.serviceId] += item.quantity || 1;
      });
    });
    const topServices = Object.entries(serviceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([serviceId, count]) => ({ serviceId, count }));
    // Average review
    const reviewsSnap = await admin
      .firestore()
      .collection("reviews")
      .where("isDeleted", "==", false)
      .where("providerId", "==", providerId)
      .get();
    const reviews = reviewsSnap.docs.map((doc) => doc.data());
    const avgReview = reviews.length
      ? reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length
      : null;
    return {
      success: true,
      totalRevenue,
      orderCount,
      activeCustomers,
      avgReview,
      topServices,
    };
  }
);

/**
 * Summarize recent reviews for a provider (AI/ML stub)
 */
/**
 * @param {functions.https.CallableContext} context
 */
export const summarizeReviews = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, providerId, limit } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const reviewsSnap = await admin
      .firestore()
      .collection("reviews")
      .where("providerId", "==", providerId)
      .where("isDeleted", "==", false)
      .orderBy("createdAt", "desc")
      .limit(limit || 20)
      .get();
    const reviews = reviewsSnap.docs.map((doc) => doc.data());
    // TODO: Integrate with OpenAI or Vertex AI for real summarization
    // For now, return a stub summary
    const avgRating = reviews.length
      ? reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length
      : null;
    const summary = `You have ${
      reviews.length
    } recent reviews. Average rating: ${
      avgRating ? avgRating.toFixed(2) : "N/A"
    }.`;
    const suggestions =
      avgRating && avgRating < 4
        ? "Consider improving service quality or response time."
        : "Keep up the good work!";
    return { success: true, summary, suggestions };
  }
);

/**
 * Update admin/provider business profile (logo, address, etc.)
 */
export const updateAdminProfile = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, adminId, ...updates } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!adminId) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    updates.updatedAt = Date.now();
    await admin
      .firestore()
      .collection("providers")
      .doc(adminId)
      .update(updates);
    return { success: true };
  }
);

/**
 * Update provider go-live status (isActive/goLive)
 */
export const updateProviderStatus = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, providerId, isActive } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!providerId) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    await admin.firestore().collection("providers").doc(providerId).update({
      isActive,
      goLiveAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { success: true };
  }
);

/**
 * Create an admin session with expiry and audit logging (multi-device supported)
 */
export const createSession = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const {
      sessionId,
      userId,
      isAdmin,
      deviceInfo,
      authToken,
      refreshToken,
      permissions,
      sessionDurationMinutes,
    } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    if (!userId) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    const expiresAt = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + (sessionDurationMinutes || 60) * 60000)
    );
    const sessionData = {
      userId,
      isAdmin: !!isAdmin,
      deviceInfo: deviceInfo || {},
      authToken,
      refreshToken,
      permissions: permissions || [],
      status: "active",
      lastActivity: now,
      createdAt: now,
      expiresAt,
    };
    const collection = isAdmin ? "adminSessions" : "userSessions";
    const docRef = await admin
      .firestore()
      .collection(collection)
      .add(sessionData);
    await auditLog({
      userId,
      action: "admin_session_create",
      details: { sessionId: docRef.id, deviceInfo },
      context: { ip: deviceInfo?.ipAddress },
    });
    return { success: true, sessionId: docRef.id, expiresAt };
  }
);

/**
 * Refresh an admin session (extend expiry) with audit logging
 */
export const refreshSession = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, isAdmin, sessionDurationMinutes } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    const expiresAt = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + (sessionDurationMinutes || 60) * 60000)
    );
    const collection = isAdmin ? "adminSessions" : "userSessions";
    await admin.firestore().collection(collection).doc(sessionId).update({
      expiresAt,
      lastActivity: admin.firestore.FieldValue.serverTimestamp(),
    });
    await auditLog({
      // @ts-ignore
      userId: context.auth.uid,
      action: "admin_session_refresh",
      details: { sessionId },
      context: {},
    });
    return { success: true, expiresAt };
  }
);

/**
 * Delete (logout) an admin session with audit logging
 */
export const deleteSession = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, isAdmin } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    const collection = isAdmin ? "adminSessions" : "userSessions";
    await admin.firestore().collection(collection).doc(sessionId).update({
      status: "revoked",
      expiresAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await auditLog({
      // @ts-ignore
      userId: context.auth.uid,
      action: "admin_session_delete",
      details: { sessionId },
      context: {},
    });
    return { success: true };
  }
);

/**
 * Validate an admin session (check expiry) with audit logging
 */
export const validateSession = functions.https.onCall(
  async (data, context: any) => {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const { sessionId, isAdmin } = data.data;
    await validateAdminSession(sessionId, context.auth.uid);
    const collection = isAdmin ? "adminSessions" : "userSessions";
    const doc = await admin
      .firestore()
      .collection(collection)
      .doc(sessionId)
      .get();
    const session = doc.data();
    if (!doc.exists || session?.status !== "active") {
      await auditLog({
        // @ts-ignore
        userId: context.auth.uid,
        action: "admin_session_invalid",
        details: { sessionId },
        context: {},
      });
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Session invalid or expired."
      );
    }
    const now = admin.firestore.Timestamp.now();
    if (session.expiresAt && now.toMillis() > session.expiresAt.toMillis()) {
      await doc.ref.update({ status: "expired" });
      await auditLog({
        // @ts-ignore
        userId: context.auth.uid,
        action: "admin_session_expired",
        details: { sessionId },
        context: {},
      });
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Session expired."
      );
    }
    await auditLog({
      // @ts-ignore
      userId: context.auth.uid,
      action: "admin_session_valid",
      details: { sessionId },
      context: {},
    });
    return { success: true, session };
  }
);

function isValidEmail(email: string): boolean {
  // Simple regex for demonstration; use a better one in production
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(phone);
}
