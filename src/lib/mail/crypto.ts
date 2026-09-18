import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function keyBytes(): Buffer {
  const secret =
    process.env.APP_SECRET?.trim() ||
    process.env.BETTER_AUTH_SECRET?.trim() ||
    "dev-preview-only-not-for-production";
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string): { ciphertext: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptSecret(parts: { ciphertext: string; iv: string; tag: string }): string {
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), Buffer.from(parts.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parts.tag, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(parts.ciphertext, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}
