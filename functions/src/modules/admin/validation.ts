// Validation and utility helpers for admin module
import * as crypto from "crypto";

export function isValidEmail(email: string): boolean {
  // Simple regex for demonstration; use a better one in production
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(phone);
}

export function generateTempToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
