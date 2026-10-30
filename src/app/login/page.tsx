import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { auth, devLoginEnabled, enabledProviders, signIn } from "@/auth";
import { db } from "@/lib/db";

export const metadata = { title: "Sign in" };

/** Sign in, but come back to this page with a readable reason instead of an error screen. */
async function signInOrExplain(provider: string, options: Record<string, unknown>, callbackUrl?: string) {
  const back = (error: string) => `/login?error=${error}${callbackUrl ? `&callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`;
  // Sign-in looks the user up in the database; when it's down Auth.js only says "AccessDenied"
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    redirect(back("Database"));
  }
  try {
    await signIn(provider, options);
  } catch (e) {
    if (e instanceof AuthError) redirect(back(e.type));
    throw e;
  }
}

const ERRORS: Record<string, (domain: string) => string> = {
  Database: () => "The database isn't running. Start it with npm run db:up in the CRM folder, then sign in again.",
  AccessDenied: (domain) => `This account can't sign in. Use your @${domain} address; if it still fails, ask an admin whether your account is active.`,
  CredentialsSignin: (domain) => `Only @${domain} accounts can sign in.`,
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; callbackUrl?: string }> }) {
  const session = await auth();
  const { error, callbackUrl } = await searchParams;
  if (session?.user) redirect(callbackUrl ?? "/");
  const domain = process.env.AUTH_ALLOWED_DOMAIN ?? "enosisbd.com";
  const oauth = enabledProviders.filter((p) => p.id !== "dev");

  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-4">
      <div className="w-full max-w-[380px] rounded-[6px] border border-line bg-surface p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-[6px] bg-primary font-semibold text-white">E</span>
          <span className="text-[17px] font-semibold">Enosis CRM</span>
        </div>
        <h1 className="mb-1 text-[20px] font-medium">Sign in</h1>
        <p className="mb-6 text-[13px] text-ink-muted">Use your @{domain} account.</p>
        {error && (
          <div className="mb-4 rounded-[3px] border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {ERRORS[error]?.(domain) ?? "Sign-in failed. Try again."}
          </div>
        )}
        <div className="space-y-2">
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
        {devLoginEnabled && (
          <form
            className="mt-4 border-t border-line pt-4"
            action={async (fd: FormData) => {
              "use server";
              await signInOrExplain("dev", { email: fd.get("email"), redirectTo: callbackUrl ?? "/" }, callbackUrl);
            }}
          >
            <label className="mb-1 block text-[12px] font-medium" htmlFor="email">
              Dev login <span className="font-normal text-ink-subtle">(local only, no password)</span>
            </label>
            <input id="email" name="email" type="email" required placeholder={`you@${domain}`} className="mb-2 h-9 w-full rounded-[3px] border border-line-strong px-2.5 text-[13px] focus:border-link focus:outline-none" />
            <button className="h-9 w-full rounded-[3px] bg-primary text-[13px] font-medium text-white hover:bg-primary-hover">Sign in</button>
          </form>
        )}
        {!oauth.length && !devLoginEnabled && (
          <p className="text-[13px] text-danger">No sign-in providers are configured. Set AUTH_GOOGLE_ID or AUTH_MICROSOFT_ENTRA_ID_ID.</p>
        )}
      </div>
    </div>
  );
}
