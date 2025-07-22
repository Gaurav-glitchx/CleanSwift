// otp.ts - OTP helpers for admin module

export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

import * as crypto from "crypto";
export function hashOtp(otp: string): string {
  return crypto.createHash("sha256").update(otp).digest("hex");
}
