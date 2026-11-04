import { createHash } from "node:crypto";
import NextAuth, { CredentialsSignin, type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import type { Provider } from "next-auth/providers";
import { authConfig, isAllowedEmail } from "./auth.config";
import { db } from "./lib/db";
import { LOCK_MINUTES, MAX_FAILED_LOGINS, verifyPassword } from "./lib/passwords";

declare module "next-auth" {
  interface Session {
    user: { id: string; role: string | null } & DefaultSession["user"];
  }
}

export const devLoginEnabled = process.env.AUTH_DEV_LOGIN === "true" && process.env.NODE_ENV !== "production";

/** Wrong email or password, or a locked account (shown as its own message). */
class LockedSignin extends CredentialsSignin {
  code = "locked";
}

/** AUTH_SECRET if set; otherwise a key derived from the database connection, which is already a secret on the server. */
function authSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const url = process.env.DATABASE_URL;
  return url ? createHash("sha256").update(`enosis-crm-auth:${url}`).digest("base64url") : undefined;
}

// Email + password: only people an admin added (Settings → Users & teams) and gave a password
const providers: Provider[] = [
  Credentials({
    id: "password",
    name: "Email and password",
    credentials: { email: { label: "Work email", type: "email" }, password: { label: "Password", type: "password" } },
    async authorize(creds) {
      const email = String(creds?.email ?? "").trim().toLowerCase();
      const password = String(creds?.password ?? "");
      const user = isAllowedEmail(email) ? await db.user.findUnique({ where: { email } }) : null;
      if (user?.lockedUntil && user.lockedUntil > new Date()) throw new LockedSignin();
      const ok = await verifyPassword(password, user?.isActive ? user.passwordHash : null);
      if (!user || !ok) {
        if (user) {
          const failed = user.failedLogins + 1;
          const lock = failed >= MAX_FAILED_LOGINS;
          await db.user.update({ where: { id: user.id }, data: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60000) : null } });
          if (lock) throw new LockedSignin();
        }
        return null;
      }
      if (user.failedLogins || user.lockedUntil) await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
      return { id: user.id, email: user.email, name: user.name };
    },
  }),
];
export const enabledProviders: { id: string; name: string }[] = [];
if (process.env.AUTH_GOOGLE_ID) {
  providers.push(Google({ authorization: { params: { hd: process.env.AUTH_ALLOWED_DOMAIN } } }));
  enabledProviders.push({ id: "google", name: "Google" });
}
if (process.env.AUTH_MICROSOFT_ENTRA_ID_ID) {
  providers.push(MicrosoftEntraID({ issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER }));
  enabledProviders.push({ id: "microsoft-entra-id", name: "Microsoft" });
}
if (devLoginEnabled) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Dev login",
      credentials: { email: { label: "Work email", type: "email" } },
      async authorize(creds) {
        const email = String(creds?.email ?? "").trim().toLowerCase();
        if (!isAllowedEmail(email)) return null;
        return { id: email, email, name: email.split("@")[0] };
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  secret: authSecret(),
  providers,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, profile }) {
      const email = (user.email ?? profile?.email ?? "").toLowerCase();
      if (!isAllowedEmail(email)) return false;
      // Deactivated in Settings → Users
      const existing = await db.user.findUnique({ where: { email }, select: { isActive: true } });
      return existing?.isActive !== false;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        const email = user.email.toLowerCase();
        const row = await db.user.upsert({
          where: { email },
          update: { lastLoginAt: new Date(), image: user.image ?? undefined },
          create: { email, name: user.name, image: user.image, lastLoginAt: new Date() },
          include: { role: true },
        });
        token.uid = row.id;
        token.name = row.name ?? token.name;
        token.role = row.role?.name ?? null;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.uid as string;
      session.user.role = (token.role as string | null) ?? null;
      return session;
    },
  },
});

/** Current user or redirect-worthy null. Use in server components & actions. */
export async function currentUser() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return session.user;
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error("Not signed in");
  return user;
}
