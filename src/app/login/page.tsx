import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { auth, devLoginEnabled, enabledProviders, signIn } from "@/auth";
import { isAllowedEmail } from "@/auth.config";
import { db } from "@/lib/db";
import { hashPassword, passwordProblem } from "@/lib/passwords";

export const metadata = { title: "Sign in" };

const back = (error: string, callbackUrl?: string, extra = "") => `/login?error=${error}${extra}${callbackUrl ? `&callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`;

/** Sign in, but come back to this page with a readable reason instead of an error screen. */
async function signInOrExplain(provider: string, options: Record<string, unknown>, callbackUrl?: string) {
  // Sign-in looks the user up in the database; when it's down Auth.js only says "AccessDenied"
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    redirect(back("Database", callbackUrl));
  }
  try {
    await signIn(provider, options);
  } catch (e) {
    if (e instanceof AuthError) redirect(back(e.type === "CredentialsSignin" && (e as { code?: string }).code === "locked" ? "Locked" : e.type, callbackUrl));
    throw e;
  }
}

/** Nobody has a password yet: the very first sign-in on a new database, done by an admin. */
const firstSetup = async () => !(await db.user.count({ where: { passwordHash: { not: null } } }));

const ERRORS: Record<string, (domain: string) => string> = {
  Database: () => "The database can't be reached. Try again in a minute; if it keeps happening, ask an admin.",
  AccessDenied: (domain) => `This account can't sign in. Use your @${domain} address; if it still fails, ask an admin whether your account is active.`,
  CredentialsSignin: () => "Wrong email or password. Ask an admin if you don't have a password yet.",
  Locked: () => "Too many wrong tries. This account is locked for 15 minutes.",
  SetupMismatch: () => "The two passwords don't match.",
  SetupWeak: () => "Use at least 10 characters, with letters and at least one number.",
  SetupNotAdmin: () => "That email isn't an active admin of this CRM.",
  SetupDone: () => "A password has already been set. Sign in with it.",
};

const input = "mb-2 h-9 w-full rounded-[3px] border border-line-strong px-2.5 text-[13px] focus:border-link focus:outline-none";
const primary = "h-9 w-full rounded-[3px] bg-primary text-[13px] font-medium text-white hover:bg-primary-hover";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; code?: string; callbackUrl?: string }> }) {
  const session = await auth();
  const sp = await searchParams;
  const { callbackUrl } = sp;
  const error = sp.error === "CredentialsSignin" && sp.code === "locked" ? "Locked" : sp.error;
  if (session?.user) redirect(callbackUrl ?? "/");
  const domain = process.env.AUTH_ALLOWED_DOMAIN ?? "enosisbd.com";
  const oauth = enabledProviders.filter((p) => p.id !== "dev");
  let setup = false;
  try {
    setup = await firstSetup();
  } catch {
    // Database down: the error message covers it
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-4">
      <div className="w-full max-w-[380px] rounded-[6px] border border-line bg-surface p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-[6px] bg-primary font-semibold text-white">E</span>
          <span className="text-[17px] font-semibold">Enosis CRM</span>
        </div>
        {error && (
          <div className="mb-4 rounded-[3px] border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {ERRORS[error]?.(domain) ?? "Sign-in failed. Try again."}
          </div>
        )}

        {setup ? (
          <form
            action={async (fd: FormData) => {
              "use server";
              const email = String(fd.get("email") ?? "").trim().toLowerCase();
              const password = String(fd.get("password") ?? "");
              if (!(await firstSetup())) redirect(back("SetupDone"));
              if (password !== String(fd.get("confirm") ?? "")) redirect(back("SetupMismatch"));
              if (passwordProblem(password)) redirect(back("SetupWeak"));
              const admin = isAllowedEmail(email) ? await db.user.findFirst({ where: { email, isActive: true, role: { name: "Admin" } } }) : null;
              if (!admin) redirect(back("SetupNotAdmin"));
              await db.user.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(password), passwordSetAt: new Date(), failedLogins: 0, lockedUntil: null } });
              await db.auditLog.create({ data: { action: "settings", changes: { firstPassword: email }, userId: admin.id } });
              await signInOrExplain("password", { email, password, redirectTo: "/" });
            }}
          >
            <h1 className="mb-1 text-[20px] font-medium">Set the admin password</h1>
            <p className="mb-4 text-[13px] text-ink-muted">
              First sign-in on this CRM: choose the password for the admin account. Afterwards, add your team and give each person a password in Settings → Users & teams.
            </p>
            <label className="mb-1 block text-[12px] font-medium" htmlFor="setup-email">
              Admin email
            </label>
            <input id="setup-email" name="email" type="email" required autoComplete="username" placeholder={`you@${domain}`} className={input} />
            <label className="mb-1 block text-[12px] font-medium" htmlFor="setup-password">
              New password <span className="font-normal text-ink-subtle">(10+ characters, letters and a number)</span>
            </label>
            <input id="setup-password" name="password" type="password" required minLength={10} autoComplete="new-password" className={input} />
            <label className="mb-1 block text-[12px] font-medium" htmlFor="setup-confirm">
              Repeat it
            </label>
            <input id="setup-confirm" name="confirm" type="password" required minLength={10} autoComplete="new-password" className={input} />
            <button className={primary}>Set password and sign in</button>
          </form>
        ) : (
          <form
            action={async (fd: FormData) => {
              "use server";
              await signInOrExplain("password", { email: fd.get("email"), password: fd.get("password"), redirectTo: callbackUrl ?? "/" }, callbackUrl);
            }}
          >
            <h1 className="mb-1 text-[20px] font-medium">Sign in</h1>
            <p className="mb-4 text-[13px] text-ink-muted">Use your @{domain} email and the password an admin gave you.</p>
            <label className="mb-1 block text-[12px] font-medium" htmlFor="email">
              Work email
            </label>
            <input id="email" name="email" type="email" required autoComplete="username" placeholder={`you@${domain}`} className={input} />
            <label className="mb-1 block text-[12px] font-medium" htmlFor="password">
              Password
            </label>
            <input id="password" name="password" type="password" required autoComplete="current-password" className={input} />
            <button className={primary}>Sign in</button>
            <p className="mt-3 text-[12px] text-ink-subtle">Forgot your password? Ask an admin to set a new one.</p>
          </form>
        )}

        {oauth.length > 0 && (
          <div className="mt-4 space-y-2 border-t border-line pt-4">
            {oauth.map((p) => (
              <form
                key={p.id}
                action={async () => {
                  "use server";
                  await signInOrExplain(p.id, { redirectTo: callbackUrl ?? "/" }, callbackUrl);
                }}
              >
                <button className="h-9 w-full rounded-[3px] border border-line-strong text-[13px] font-medium hover:bg-surface-hover">Continue with {p.name}</button>
              </form>
            ))}
          </div>
        )}
        {devLoginEnabled && (
          <form
            className="mt-4 border-t border-line pt-4"
            action={async (fd: FormData) => {
              "use server";
              await signInOrExplain("dev", { email: fd.get("email"), redirectTo: callbackUrl ?? "/" }, callbackUrl);
            }}
          >
            <label className="mb-1 block text-[12px] font-medium" htmlFor="dev-email">
              Dev login <span className="font-normal text-ink-subtle">(local only, no password)</span>
            </label>
            <input id="dev-email" name="email" type="email" required placeholder={`you@${domain}`} className={input} />
            <button className="h-9 w-full rounded-[3px] border border-line-strong text-[13px] font-medium hover:bg-surface-hover">Dev sign in</button>
          </form>
        )}
      </div>
    </div>
  );
}
