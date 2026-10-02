import "next-auth";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      sessionId: string;
      sessionVersion: number;
      signedInAt: string;
      recentAuthAt: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sid?: string;
    sv?: number;
    signedInAt?: string;
    recentAuthAt?: string;
  }
}
