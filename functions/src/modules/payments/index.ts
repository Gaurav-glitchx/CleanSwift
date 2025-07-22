// import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
// import Stripe from "stripe";

if (!admin.apps.length) {
  admin.initializeApp();
}

// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
//   apiVersion: "2025-06-30.basil",
// });
// const ordersRef = admin.firestore().collection("orders");

/**
 * Generate Stripe Connect onboarding link for a provider
 */
// export const getStripeOnboardingLink = functions.https.onCall(
//   async (data, context) => {
//     const { providerId, refreshUrl, returnUrl } = data.data;
//     // @ts-ignore
//     if (!context.auth || !providerId || !refreshUrl || !returnUrl) {
//       throw new functions.https.HttpsError(
//         "invalid-argument",
//         "Missing required fields."
//       );
//     }
//     // Create Stripe account if not exists
//     const providerRef = admin
//       .firestore()
//       .collection("providers")
//       .doc(providerId);
//     const providerDoc = await providerRef.get();
//     if (!providerDoc.exists) {
//       throw new functions.https.HttpsError("not-found", "Provider not found.");
//     }
//     let stripeAccountId = providerDoc.data()?.stripeId;
//     if (!stripeAccountId) {
//       const account = await stripe.accounts.create({
//         type: "express",
//         email: providerDoc.data()?.email,
//       });
//       stripeAccountId = account.id;
//       await providerRef.update({ stripeId: stripeAccountId });
//     }
//     // Generate onboarding link
//     const accountLink = await stripe.accountLinks.create({
//       account: stripeAccountId,
//       refresh_url: refreshUrl,
//       return_url: returnUrl,
//       type: "account_onboarding",
//     });
//     return { success: true, url: accountLink.url };
//   }
// );

/**
 * Update createPaymentIntent to support destination charges
 */
// export const createPaymentIntent = functions.https.onCall(
//   async (data, context) => {
//     const { orderId, amount, currency, providerId } = data.data;
//     // @ts-ignore
//     if (!context.auth || !orderId || !amount || !currency || !providerId) {
//       throw new functions.https.HttpsError(
//         "invalid-argument",
//         "Missing required fields."
//       );
//     }
//     // Check order exists and not already paid
//     const orderDoc = await ordersRef.doc(orderId).get();
//     if (!orderDoc.exists) {
//       throw new functions.https.HttpsError("not-found", "Order not found.");
//     }
//     const order = orderDoc.data();
//     if (!order) {
//       throw new functions.https.HttpsError(
//         "not-found",
//         "Order data not found."
//       );
//     }
//     if (order.payment && order.payment.status === "paid") {
//       throw new functions.https.HttpsError(
//         "already-exists",
//         "Order already paid."
//       );
//     }
//     // Get provider's Stripe account ID
//     const providerDoc = await admin
//       .firestore()
//       .collection("providers")
//       .doc(providerId)
//       .get();
//     const stripeAccountId = providerDoc.data()?.stripeId;
//     if (!stripeAccountId) {
//       throw new functions.https.HttpsError(
//         "failed-precondition",
//         "Provider has not completed Stripe onboarding."
//       );
//     }
//     // Create payment intent with destination charge
//     let paymentIntent;
//     try {
//       paymentIntent = await stripe.paymentIntents.create({
//         amount: Math.round(amount * 100),
//         currency,
//         metadata: { orderId },
//         automatic_payment_methods: { enabled: true },
//         transfer_data: { destination: stripeAccountId },
//       });
//     } catch (err: any) {
//       throw new functions.https.HttpsError(
//         "internal",
//         "Failed to create payment intent: " + err.message
//       );
//     }
//     // Save payment intent id to order
//     await ordersRef
//       .doc(orderId)
//       .update({ "payment.intentId": paymentIntent.id });
//     return { success: true, clientSecret: paymentIntent.client_secret };
//   }
// );

/**
 * Stripe Webhook Handler
 */
// export const handleStripeWebhook = functions.https.onRequest(
//   async (req, res) => {
//     const sig = req.headers["stripe-signature"];
//     let event;
//     try {
//       event = stripe.webhooks.constructEvent(
//         req.rawBody,
//         sig as string,
//         process.env.STRIPE_WEBHOOK_SECRET as string
//       );
//     } catch (err: any) {
//       functions.logger.error(
//         "Webhook signature verification failed.",
//         err.message
//       );
//       res.status(400).send(`Webhook Error: ${err.message}`);
//       return;
//     }
//     // Handle payment_intent.succeeded
//     if (event.type === "payment_intent.succeeded") {
//       const paymentIntent = event.data.object as Stripe.PaymentIntent;
//       const orderId = paymentIntent.metadata.orderId;
//       await ordersRef.doc(orderId).update({
//         "payment.status": "paid",
//         "payment.transactionId": paymentIntent.id,
//       });
//     }
//     // Handle payment_intent.payment_failed
//     if (event.type === "payment_intent.payment_failed") {
//       const paymentIntent = event.data.object as Stripe.PaymentIntent;
//       const orderId = paymentIntent.metadata.orderId;
//       await ordersRef.doc(orderId).update({
//         "payment.status": "failed",
//         "payment.transactionId": paymentIntent.id,
//       });
//     }
//     res.status(200).send("Received");
//   }
// );
