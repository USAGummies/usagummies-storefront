/**
 * NextAuth.js v5 Configuration — USA Gummies Operations Platform
 *
 * Uses CredentialsProvider with Notion-backed user database.
 * Includes retry logic + hardcoded admin fallback for reliability.
 * JWT sessions (no DB needed for sessions).
 */

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import {
  findUserByEmail,
  verifyPassword,
  updateLastLogin,
} from "./notion-user-adapter";
import type { UserRole } from "./notion-user-adapter";

declare module "next-auth" {
  interface User {
    role?: UserRole;
  }
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: UserRole;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true, // Required for Vercel — behind proxy, host header varies
  pages: {
    signIn: "/ops/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  providers: [
    Credentials({
      name: "USA Gummies",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        try {
          const email = credentials?.email as string | undefined;
          const password = credentials?.password as string | undefined;

          if (!email || !password) return null;

          const user = await findUserByEmail(email);
          if (!user) {
            console.error("[auth] No user found for:", email);
            return null;
          }

          const valid = await verifyPassword(password, user);
          if (!valid) {
            console.error("[auth] Invalid password for:", email);
            return null;
          }

          // Fire-and-forget last login update
          updateLastLogin(user.id).catch(() => {});

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
          };
        } catch (err) {
          console.error("[auth] authorize() error:", err);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        token.role = (user as any).role as UserRole;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      return session;
    },
  },
});
