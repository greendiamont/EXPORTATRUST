import Link from "next/link";
import type { ReactNode } from "react";
import "./et2.css";

export type ShellSection = "painel" | "pedidos" | "cadastros" | "eudr" | "relatorios";

const NAV: Array<{ key: ShellSection; label: string; href: string }> = [
  { key: "painel", label: "Painel", href: "/" },
  { key: "pedidos", label: "Pedidos", href: "/pedidos" },
  { key: "cadastros", label: "Cadastros", href: "/cadastros" },
  // EUDR e Relatórios ainda usam as telas atuais (etapas seguintes do redesenho).
  { key: "eudr", label: "EUDR", href: "/classico" },
  { key: "relatorios", label: "Relatórios", href: "/classico?module=Relat%C3%B3rios" },
];

function initials(name: string) {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase() || "?";
}

export default function Shell({ active, userName, userEmail, environment, signOutHref, children }: {
  active: ShellSection;
  userName: string;
  userEmail: string;
  environment: string;
  signOutHref: string;
  children: ReactNode;
}) {
  const envLabel = environment && environment !== "production" ? (environment === "homologation" ? "Homologação" : environment) : "";
  return (
    <div className="et2">
      <header className="et2-top">
        <div className="et2-top-inner">
          <Link href="/" className="et2-brand">
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#5FD3A6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12l6 6L21 6" /></svg>
            ExportaTrust
          </Link>
          <nav className="et2-nav" aria-label="Navegação principal">
            {NAV.map((item) => (
              <a key={item.key} href={item.href} aria-current={item.key === active ? "page" : undefined}>{item.label}</a>
            ))}
          </nav>
          <div className="et2-user">
            {envLabel && <span className="et2-env">{envLabel}</span>}
            <a href="/classico" style={{ color: "#c3cbd8", fontSize: 12 }}>Versão anterior</a>
            <span className="et2-avatar" title={`${userName} · ${userEmail}`}>{initials(userName || userEmail)}</span>
            <a href={signOutHref} style={{ color: "#c3cbd8", fontSize: 12 }}>Sair</a>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
