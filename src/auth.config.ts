import type { NextAuthConfig } from "next-auth";

const allowedDomain = (process.env.AUTH_ALLOWED_DOMAIN ?? "enosisbd.com").toLowerCase();

export function isAllowedEmail(email: string | null | undefined) {
  return !!email && email.toLowerCase().endsWith(`@${allowedDomain}`);
}

/** Edge-safe part of the Auth.js config (used by middleware). */
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const isLogin = request.nextUrl.pathname.startsWith("/login");
      if (isLogin) return true;
      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;
