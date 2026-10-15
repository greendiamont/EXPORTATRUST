import type { ReactNode } from "react";
import { getSecurityContext, type SecurityContext } from "../../lib/security";
import { ensureDailyBackup } from "../../lib/backup";
import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser } from "../chatgpt-auth";
import Shell, { type ShellSection } from "./shell";

async function appEnvironment() {
  try {
    const { env } = await import("cloudflare:workers");
    return String((env as unknown as Record<string, unknown>).APP_ENV ?? "");
  } catch {
    return "";
  }
}

/**
 * Mesma regra de acesso da página atual (app/classico): sem sessão não há dados.
 * Com sessão, envolve o conteúdo na barra superior da interface nova.
 */
export async function guardedPage(active: ShellSection, returnTo: string, render: (security: SecurityContext) => ReactNode) {
  const signedInUser = await getChatGPTUser();
  const security = await getSecurityContext();
  if (!security) {
    return (
      <main className="auth-gate"><section><span className="auth-gate-mark">ET</span>
        <p className="eyebrow">{signedInUser ? "ACESSO CONTROLADO" : "EXPORTATRUST SECURE ACCESS"}</p>
        <h1>{signedInUser ? "Seu login foi confirmado, mas ainda não há uma empresa liberada." : "Entre para acessar o ExportaTrust"}</h1>
        <p>{signedInUser ? <>Peça ao administrador para cadastrar o e-mail <strong>{signedInUser.email}</strong> e definir seu perfil.</> : "Processos, documentos e dossiês são protegidos por identidade e autorização da empresa."}</p>
        <a href={signedInUser ? chatGPTSignOutPath("/") : chatGPTSignInPath(returnTo)}>{signedInUser ? "Entrar com outra conta →" : "Entrar com segurança →"}</a>
      </section></main>
    );
  }
  try { await ensureDailyBackup(security); } catch { /* o acesso nunca é bloqueado pelo backup */ }
  return (
    <Shell active={active} userName={security.fullName} userEmail={security.email} environment={await appEnvironment()} signOutHref={chatGPTSignOutPath("/")}>
      {render(security)}
    </Shell>
  );
}
