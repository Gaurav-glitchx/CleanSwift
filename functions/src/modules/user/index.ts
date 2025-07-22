import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { auditLog } from "../utils";

/**
 * User Registration: Sign up with email/password or Google OAuth
 * - Creates Firebase Auth user
 * - Stores user profile in Firestore
 * - Handles duplicate email, username, and verification
 */
export const createUser = functions.https.onCall(async (data, context) => {
  const {
    firstName,
    lastName,
    userName,
    email,
    phoneNumber,
    dob,
    preferredLanguage,
  } = data.data;

  if (!firstName || !lastName || !userName || !email || !phoneNumber) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Missing required fields."
    );
  }

  const usersRef = admin.firestore().collection("users");
  const [emailSnap, userNameSnap] = await Promise.all([
    usersRef.where("email", "==", email).get(),
    usersRef.where("userName", "==", userName).get(),
  ]);
  if (!emailSnap.empty) {
    throw new functions.https.HttpsError(
      "already-exists",
      "Email already in use."
    );
  }
  if (!userNameSnap.empty) {
    throw new functions.https.HttpsError(
      "already-exists",
      "Username already in use."
    );
  }

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({
      email,
      phoneNumber,
      displayName: `${firstName} ${lastName}`,
      emailVerified: false,
      disabled: false,
    });
  } catch (err: any) {
    throw new functions.https.HttpsError(
      "internal",
      "Failed to create auth user: " + err.message
    );
  }

  const now = Date.now();
  const userData = {
    userId: userRecord.uid,
    firstName,
    lastName,
    userName,
    phoneNumber,
    email,
    isVerified: false,
    dob: dob || null,
    paymentId: null,
    defaultAddressId: null,
    profileKey: null,
    preferredLanguage: preferredLanguage || "en",
    status: "active",
    lastLogin: null,
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  };
  await usersRef.doc(userRecord.uid).set(userData);

  try {
    await admin.auth().generateEmailVerificationLink(email);
  } catch (err: any) {
    functions.logger.warn("Failed to send verification email:", err.message);
  }

  return { success: true, userId: userRecord.uid };
});

const reviewsRef = admin.firestore().collection("reviews");

/**
 * Create a review for an order
 */
export const createReview = functions.https.onCall(async (data, context) => {
  const { orderId, userId, rating, comment, images } = data.data;
  // @ts-ignore
  if (!context.auth || !orderId || !userId || !rating) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Missing required fields."
    );
  }
  // Prevent duplicate review for the same order by the same user
  const dupSnap = await reviewsRef
    .where("orderId", "==", orderId)
    .where("userId", "==", userId)
    .where("isDeleted", "==", false)
    .get();
  if (!dupSnap.empty) {
    throw new functions.https.HttpsError(
      "already-exists",
      "Review already exists for this order by this user."
    );
  }
  const now = Date.now();
  const reviewData = {
    orderId,
    userId,
    rating,
    comment: comment || "",
    images: images || [],
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  };
  const docRef = await reviewsRef.add(reviewData);
  return { success: true, reviewId: docRef.id };
});

/**
 * Update a review
 */
export const updateReview = functions.https.onCall(async (data, context) => {
  const { reviewId, userId, ...updates } = data.data;
  // @ts-ignore
  if (!context.auth || !reviewId || !userId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Missing required fields."
    );
  }
  const docRef = reviewsRef.doc(reviewId);
  const doc = await docRef.get();
  if (!doc.exists || doc.data()?.userId !== userId) {
    throw new functions.https.HttpsError("not-found", "Review not found.");
  }
  updates.updatedAt = Date.now();
  await docRef.update(updates);
  return { success: true };
});

/**
 * Soft delete a review
 */
export const deleteReview = functions.https.onCall(async (data, context) => {
  const { reviewId, userId } = data.data;
  // @ts-ignore
  if (!context.auth || !reviewId || !userId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Missing required fields."
    );
  }
  const docRef = reviewsRef.doc(reviewId);
  const doc = await docRef.get();
  if (!doc.exists || doc.data()?.userId !== userId) {
    throw new functions.https.HttpsError("not-found", "Review not found.");
  }
  await docRef.update({
    isDeleted: true,
    updatedAt: Date.now(),
  });
  return { success: true };
});

/**
 * List all active (not deleted) reviews for a user or order
 */
export const listReviews = functions.https.onCall(async (data, context) => {
  const { userId, orderId } = data.data;
  // @ts-ignore
  if (!context.auth || (!userId && !orderId)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Missing required fields."
    );
  }
  let query;
  if (userId) {
    query = reviewsRef
      .where("userId", "==", userId)
      .where("isDeleted", "==", false);
  } else {
    query = reviewsRef
      .where("orderId", "==", orderId)
      .where("isDeleted", "==", false);
  }
  const snap = await query.get();
  const reviews = snap.docs.map((doc) => ({ reviewId: doc.id, ...doc.data() }));
  return { success: true, reviews };
});

const paymentMethodsRef = admin.firestore().collection("paymentMethods");

/**
 * Create a payment method for a user
 */
export const createPaymentMethod = functions.https.onCall(
  async (data, context) => {
    const { userId, methodType, provider, isDefault, details } = data.data;
    // @ts-ignore
    if (!context.auth || !userId || !methodType || !provider || !details) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    // If isDefault, unset previous default for this user
    if (isDefault) {
      const prevDefault = await paymentMethodsRef
        .where("userId", "==", userId)
        .where("isDefault", "==", true)
        .where("isDeleted", "==", false)
        .get();
      const batch = admin.firestore().batch();
      prevDefault.forEach((doc) => batch.update(doc.ref, { isDefault: false }));
      await batch.commit();
    }
    const now = Date.now();
    const paymentMethodData = {
      userId,
      methodType,
      provider,
      isDefault: !!isDefault,
      details,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    };
    const docRef = await paymentMethodsRef.add(paymentMethodData);
    return { success: true, paymentId: docRef.id };
  }
);

/**
 * Update a payment method
 */
export const updatePaymentMethod = functions.https.onCall(
  async (data, context) => {
    const { paymentId, userId, ...updates } = data.data;
    // @ts-ignore
    if (!context.auth || !paymentId || !userId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    const docRef = paymentMethodsRef.doc(paymentId);
    const doc = await docRef.get();
    if (!doc.exists || doc.data()?.userId !== userId) {
      throw new functions.https.HttpsError(
        "not-found",
        "Payment method not found."
      );
    }
    // If setting as default, unset previous default
    if (updates.isDefault) {
      const prevDefault = await paymentMethodsRef
        .where("userId", "==", userId)
        .where("isDefault", "==", true)
        .where("isDeleted", "==", false)
        .get();
      const batch = admin.firestore().batch();
      prevDefault.forEach((d) => {
        if (d.id !== paymentId) batch.update(d.ref, { isDefault: false });
      });
      await batch.commit();
    }
    updates.updatedAt = Date.now();
    await docRef.update(updates);
    return { success: true };
  }
);

/**
 * Soft delete a payment method
 */
export const deletePaymentMethod = functions.https.onCall(
  async (data, context) => {
    const { paymentId, userId } = data.data;
    // @ts-ignore
    if (!context.auth || !paymentId || !userId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    const docRef = paymentMethodsRef.doc(paymentId);
    const doc = await docRef.get();
    if (!doc.exists || doc.data()?.userId !== userId) {
      throw new functions.https.HttpsError(
        "not-found",
        "Payment method not found."
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
 * List all active (not deleted) payment methods for a user
 */
export const listPaymentMethods = functions.https.onCall(
  async (data, context) => {
    const { userId } = data.data;
    // @ts-ignore
    if (!context.auth || !userId) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const snap = await paymentMethodsRef
      .where("userId", "==", userId)
      .where("isDeleted", "==", false)
      .get();
    const paymentMethods = snap.docs.map((doc) => ({
      paymentId: doc.id,
      ...doc.data(),
    }));
    return { success: true, paymentMethods };
  }
);

const userAddressesRef = admin.firestore().collection("userAddresses");

/**
 * Create a user address
 */
export const createUserAddress = functions.https.onCall(
  async (data, context) => {
    const {
      userId,
      addressType,
      contact,
      addressComponents,
      location,
      isDefault,
    } = data.data;

    if (
      // @ts-ignore
      !context.auth ||
      !userId ||
      !addressType ||
      !contact ||
      !addressComponents ||
      !location
    ) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    // If isDefault, unset previous default for this user
    if (isDefault) {
      const prevDefault = await userAddressesRef
        .where("userId", "==", userId)
        .where("isDefault", "==", true)
        .where("isDeleted", "==", false)
        .get();
      const batch = admin.firestore().batch();
      prevDefault.forEach((doc) => batch.update(doc.ref, { isDefault: false }));
      await batch.commit();
    }
    const now = Date.now();
    const addressData = {
      userId,
      addressType,
      contact,
      addressComponents,
      location,
      isDefault: !!isDefault,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    };
    const docRef = await userAddressesRef.add(addressData);
    return { success: true, addressId: docRef.id };
  }
);

/**
 * Update a user address
 */
export const updateUserAddress = functions.https.onCall(
  async (data, context) => {
    const { addressId, userId, ...updates } = data.data;
    // @ts-ignore
    if (!context.auth || !addressId || !userId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    const docRef = userAddressesRef.doc(addressId);
    const doc = await docRef.get();
    if (!doc.exists || doc.data()?.userId !== userId) {
      throw new functions.https.HttpsError("not-found", "Address not found.");
    }
    // If setting as default, unset previous default
    if (updates.isDefault) {
      const prevDefault = await userAddressesRef
        .where("userId", "==", userId)
        .where("isDefault", "==", true)
        .where("isDeleted", "==", false)
        .get();
      const batch = admin.firestore().batch();
      prevDefault.forEach((d) => {
        if (d.id !== addressId) batch.update(d.ref, { isDefault: false });
      });
      await batch.commit();
    }
    updates.updatedAt = Date.now();
    await docRef.update(updates);
    return { success: true };
  }
);

/**
 * Soft delete a user address
 */
export const deleteUserAddress = functions.https.onCall(
  async (data, context) => {
    const { addressId, userId } = data.data;
    // @ts-ignore
    if (!context.auth || !addressId || !userId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields."
      );
    }
    const docRef = userAddressesRef.doc(addressId);
    const doc = await docRef.get();
    if (!doc.exists || doc.data()?.userId !== userId) {
      throw new functions.https.HttpsError("not-found", "Address not found.");
    }
    await docRef.update({
      isDeleted: true,
      updatedAt: Date.now(),
    });
    return { success: true };
  }
);

/**
 * List all active (not deleted) addresses for a user
 */
export const listUserAddresses = functions.https.onCall(
  async (data, context) => {
    const { userId } = data.data;
    // @ts-ignore
    if (!context.auth || !userId) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required."
      );
    }
    const snap = await userAddressesRef
      .where("userId", "==", userId)
      .where("isDeleted", "==", false)
      .get();
    const addresses = snap.docs.map((doc) => ({
      addressId: doc.id,
      ...doc.data(),
    }));
    return { success: true, addresses };
  }
);

/**
 * Export all user-related data (GDPR)
 */
export const exportUserData = functions.https.onCall(async (data, context) => {
  const { userId } = data.data;
  // @ts-ignore
  if (!context.auth || !userId || context.auth.uid !== userId) {
    throw new functions.https.HttpsError("permission-denied", "Not allowed.");
  }
  const db = admin.firestore();
  const collections = [
    "users",
    "orders",
    "reviews",
    "userAddresses",
    "paymentMethods",
    "notifications",
  ];
  const result: Record<string, any[]> = {};
  for (const col of collections) {
    const snap = await db.collection(col).where("userId", "==", userId).get();
    result[col] = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }
  return { success: true, data: result };
});

/**
 * Delete user account and all related data (GDPR)
 */
export const deleteUserAccount = functions.https.onCall(
  async (data, context) => {
    const { userId } = data.data;
    // @ts-ignore
    if (!context.auth || !userId || context.auth.uid !== userId) {
      throw new functions.https.HttpsError("permission-denied", "Not allowed.");
    }
    const db = admin.firestore();
    const collections = [
      "users",
      "orders",
      "reviews",
      "userAddresses",
      "paymentMethods",
      "notifications",
    ];
    for (const col of collections) {
      const snap = await db.collection(col).where("userId", "==", userId).get();
      const batch = db.batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }
    // Disable Auth account
    await admin.auth().updateUser(userId, { disabled: true });
    return { success: true };
  }
);

/**
 * Create a user session with expiry and audit logging (multi-device supported)
 */
export const createSession = functions.https.onCall(async (data, context) => {
  const {
    userId,
    deviceInfo,
    authToken,
    refreshToken,
    permissions,
    sessionDurationMinutes,
  } = data.data;
  // @ts-ignore
  if (!context.auth || !userId) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required."
    );
  }
  const now = Date.now();
  const expiresAt = new Date(
    Date.now() + (sessionDurationMinutes || 60) * 60000
  );
  const sessionData = {
    userId,
    deviceInfo: deviceInfo || {},
    authToken,
    refreshToken,
    permissions: permissions || [],
    status: "active",
    lastActivity: now,
    createdAt: now,
    expiresAt,
  };
  const docRef = await admin
    .firestore()
    .collection("userSessions")
    .add(sessionData);
  await auditLog({
    userId,
    action: "user_session_create",
    details: { sessionId: docRef.id, deviceInfo },
    context: { ip: deviceInfo?.ipAddress },
  });
  return { success: true, sessionId: docRef.id, expiresAt };
});

/**
 * Refresh a user session (extend expiry) with audit logging
 */
export const refreshSession = functions.https.onCall(async (data, context) => {
  const { sessionId, sessionDurationMinutes } = data.data;
  // @ts-ignore
  if (!context.auth || !sessionId) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required."
    );
  }
  const expiresAt = new Date(
    Date.now() + (sessionDurationMinutes || 60) * 60000
  );
  await admin.firestore().collection("userSessions").doc(sessionId).update({
    expiresAt,
    lastActivity: Date.now(),
  });
  await auditLog({
    // @ts-ignore
    userId: context.auth.uid,
    action: "user_session_refresh",
    details: { sessionId },
    context: {},
  });
  return { success: true, expiresAt };
});

/**
 * Delete (logout) a user session with audit logging
 */
export const deleteSession = functions.https.onCall(async (data, context) => {
  const { sessionId } = data.data;
  // @ts-ignore
  if (!context.auth || !sessionId) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required."
    );
  }
  await admin.firestore().collection("userSessions").doc(sessionId).update({
    status: "revoked",
    expiresAt: Date.now(),
  });
  await auditLog({
    // @ts-ignore
    userId: context.auth.uid,
    action: "user_session_delete",
    details: { sessionId },
    context: {},
  });
  return { success: true };
});

/**
 * Validate a user session (check expiry) with audit logging
 */
export const validateSession = functions.https.onCall(async (data, context) => {
  const { sessionId } = data.data;
  // @ts-ignore
  if (!context.auth || !sessionId) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required."
    );
  }
  const doc = await admin
    .firestore()
    .collection("userSessions")
    .doc(sessionId)
    .get();
  const session = doc.data();
  if (!doc.exists || session?.status !== "active") {
    await auditLog({
      // @ts-ignore
      userId: context.auth.uid,
      action: "user_session_invalid",
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
      action: "user_session_expired",
      details: { sessionId },
      context: {},
    });
    throw new functions.https.HttpsError("unauthenticated", "Session expired.");
  }
  await auditLog({
    // @ts-ignore
    userId: context.auth.uid,
    action: "user_session_valid",
    details: { sessionId },
    context: {},
  });
  return { success: true, session };
});
