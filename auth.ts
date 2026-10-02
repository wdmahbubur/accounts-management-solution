import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { withDatabase } from "./apps/web/server/database.ts";

const sessionLifetimeSeconds = 8 * 60 * 60;

type IdentityRow = {
  id: string;
  email_normalized: string;
  display_name: string;
  password_hash: string;
  session_version: string | number;
};

const nextAuth = NextAuth({
  secret: process.env.AUTH_SECRET,
  pages: { signIn: "/auth/sign-in" },
  session: { strategy: "jwt", maxAge: sessionLifetimeSeconds },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        const email = typeof credentials?.email === "string"
          ? credentials.email.trim().toLowerCase()
          : "";
        const password = typeof credentials?.password === "string"
          ? credentials.password
          : "";
        if (!email || !password || email.length > 254 || password.length > 1024) return null;

        const user = await withDatabase(async (client) => {
          const result = await client.query<IdentityRow>(
            `SELECT id::text, email_normalized, display_name, password_hash, session_version
             FROM identity.users
             WHERE email_normalized = $1 AND email_verified_at IS NOT NULL AND disabled_at IS NULL`,
            [email]
          );
          return result.rows[0] ?? null;
        });

        if (!user) return null;
        let valid = false;
        try {
          valid = await argon2.verify(user.password_hash, password);
        } catch {
          return null;
        }
        if (!valid) return null;

        const sessionId = randomUUID();
        const sessionVersion = Number(user.session_version);
        await withDatabase((client) => client.query(
          `INSERT INTO identity.auth_sessions (id, user_id, session_version, expires_at)
           VALUES ($1::uuid, $2::uuid, $3, now() + interval '8 hours')`,
          [sessionId, user.id, sessionVersion]
        ));

        return {
          id: user.id,
          email: user.email_normalized,
          name: user.display_name,
          sessionId,
          sessionVersion
        };
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const sessionUser = user as typeof user & { sessionId?: string; sessionVersion?: number };
        token.sub = user.id;
        token.sid = sessionUser.sessionId;
        token.sv = sessionUser.sessionVersion;
        return token;
      }

      if (!token.sub || !token.sid || typeof token.sv !== "number") return {};
      const active = await withDatabase(async (client) => {
        const result = await client.query(
          `SELECT 1
           FROM identity.auth_sessions s
           JOIN identity.users u ON u.id = s.user_id
           WHERE s.id = $1::uuid AND s.user_id = $2::uuid
             AND s.session_version = $3 AND u.session_version = $3
             AND s.revoked_at IS NULL AND s.expires_at > now()
             AND u.disabled_at IS NULL AND u.email_verified_at IS NOT NULL`,
          [token.sid, token.sub, token.sv]
        );
        return result.rowCount === 1;
      });
      return active ? token : {};
    },
    async session({ session, token }) {
      session.user.id = token.sub ?? "";
      session.user.sessionId = typeof token.sid === "string" ? token.sid : "";
      session.user.sessionVersion = typeof token.sv === "number" ? token.sv : -1;
      return session;
    }
  },
  events: {
    async signOut(message) {
      const token = "token" in message ? message.token : null;
      if (!token?.sid) return;
      await withDatabase((client) => client.query(
        "UPDATE identity.auth_sessions SET revoked_at = now() WHERE id = $1::uuid AND revoked_at IS NULL",
        [token.sid]
      ));
    }
  }
});

export const { handlers, signIn, signOut } = nextAuth;

export async function auth() {
  const session = await nextAuth.auth();
  if (!session?.user?.id || !session.user.sessionId || session.user.sessionVersion < 0) return null;
  return session;
}
