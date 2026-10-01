import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { invitationToken } from "./contracts.ts";
export interface DeliveryEnvelope { version: 1; iv: string; ciphertext: string; tag: string }
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(invitationToken(token), "utf8").digest("hex");
}
function deliveryKey(value: string | undefined): Buffer {
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) throw new Error("Configure INVITATION_DELIVERY_KEY with a private 32-byte hexadecimal key.");
  return Buffer.from(value, "hex");
}
function aad(organizationId: string, invitationId: string, hash: string): Buffer {
  return Buffer.from(`ams:invitation:v1:${organizationId}:${invitationId}:${hash}`);
}
export function createInvitationSecret(organizationId: string, invitationId: string,
  key: string | undefined = process.env.INVITATION_DELIVERY_KEY) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashInvitationToken(token);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deliveryKey(key), iv);
  cipher.setAAD(aad(organizationId, invitationId, tokenHash));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const delivery: DeliveryEnvelope = { version: 1, iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
  return { tokenHash, delivery, invitationPath: `/invite/${token}` };
}
/** For the separately authorized delivery worker. Never expose this function as an API. */
export function decryptInvitationDelivery(organizationId: string, invitationId: string, tokenHash: string,
  envelope: DeliveryEnvelope, key: string | undefined = process.env.INVITATION_DELIVERY_KEY): string {
  if (envelope.version !== 1 || !/^[a-f0-9]{64}$/.test(tokenHash) ||
    !/^[A-Za-z0-9_-]{16}$/.test(envelope.iv) || !/^[A-Za-z0-9_-]{22}$/.test(envelope.tag) ||
    !/^[A-Za-z0-9_-]{58}$/.test(envelope.ciphertext)) throw new Error("Invalid delivery envelope.");
  const decipher = createDecipheriv("aes-256-gcm", deliveryKey(key), Buffer.from(envelope.iv, "base64url"));
  decipher.setAAD(aad(organizationId, invitationId, tokenHash));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  const token = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final()]).toString("utf8");
  if (!timingSafeEqual(Buffer.from(hashInvitationToken(token), "hex"), Buffer.from(tokenHash, "hex"))) throw new Error("Invalid token binding.");
  return token;
}
