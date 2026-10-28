import { redirect } from "next/navigation";
import { auth, devLoginEnabled, enabledProviders, signIn } from "@/auth";

export const metadata = { title: "Sign in" };

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
            {error === "AccessDenied" || error === "CredentialsSignin" ? `Only @${domain} accounts can sign in.` : "Sign-in failed. Try again."}
          </div>
        )}
        <div className="space-y-2">
          {oauth.map((p) => (
            <form
              key={p.id}
              action={async () => {
                "use server";
                await signIn(p.id, { redirectTo: callbackUrl ?? "/" });
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
              await signIn("dev", { email: fd.get("email"), redirectTo: callbackUrl ?? "/" });
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
