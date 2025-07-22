# Clean Swift Backend (Firebase)

A professional, modular backend for the Clean Swift SaaS platform, built with Firebase Functions, Firestore, and Stripe.

## Features

- Multi-tenant (provider/admin) and user support
- Admin onboarding, user registration, service CRUD, order management, payments, notifications
- Edge case handling and robust security rules

## Setup

1. Clone the repo and `cd` into the project directory.
2. Install Firebase CLI: `npm install -g firebase-tools`
3. Install dependencies:
   ```bash
   cd functions
   npm install
   ```
4. Set up environment variables in `.env` (inside `functions/`):
   ```env
   STRIPE_SECRET_KEY=your_stripe_secret
   STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
   ```
5. Log in to Firebase: `firebase login`
6. Set your Firebase project: `firebase use --add`

## Deployment

To deploy all functions:

```bash
firebase deploy --only functions
```

## API Usage

- All endpoints are callable via Firebase Functions (see `src/modules/*` for details)
- Use Firebase Auth tokens for authentication
- Payment handled via Stripe (see `payments` module)
- Notifications are stubbed for email/SMS/push (see `notifications` module)

## Security

- Firestore security rules enforce RBAC and data privacy
- Only authenticated users/providers can access their data

## Testing

- Add your test cases in `functions/test/`
- Run tests with your preferred framework (e.g., Jest)

## Contributing

- Modularize new features under `src/modules/`
- Follow TypeScript and Firebase best practices

## License

MIT
