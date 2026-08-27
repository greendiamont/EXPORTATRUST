/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type ScheduledController = {
  cron: string;
  scheduledTime: number;
};

type GmailSyncIdentity = {
  organization_id: number;
  user_id: number;
  email: string;
  full_name: string;
  last_sync_at: string | null;
};

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

async function runHourlyGmailSync(env: Env, ctx: ExecutionContext) {
  const result = await env.DB.prepare(`
    SELECT
      gc.organization_id,
      gc.user_id,
      gc.last_sync_at,
      u.email,
      u.full_name
    FROM gmail_connections gc
    INNER JOIN app_users u ON u.id = gc.user_id
    INNER JOIN organization_memberships m
      ON m.organization_id = gc.organization_id
      AND m.user_id = gc.user_id
    WHERE gc.status = 'Ativo'
      AND u.status = 'Ativo'
      AND m.status = 'Ativo'
    ORDER BY gc.organization_id, gc.user_id
  `).all<GmailSyncIdentity>();

  const identities = result.results ?? [];
  const now = Date.now();

  for (const identity of identities) {
    // Evita uma segunda varredura pesada quando o usuário acabou de executar
    // uma sincronização manual. O cron seguinte volta ao ritmo normal.
    const lastSyncAt = identity.last_sync_at ? Date.parse(identity.last_sync_at) : 0;
    if (lastSyncAt && now - lastSyncAt < 45 * 60_000) continue;

    const request = new Request("https://exportatrust.internal/api/integrations/gmail/sync", {
      method: "POST",
      headers: {
        "oai-authenticated-user-email": identity.email,
        "oai-authenticated-user-full-name": encodeURIComponent(identity.full_name || identity.email),
        "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
        "cookie": `exportatrust_org=${identity.organization_id}`,
        "x-exportatrust-trigger": "cloudflare-cron-hourly",
      },
    });

    try {
      const response = await handler.fetch(request, env, ctx);
      if (!response.ok) {
        const body = (await response.text()).slice(0, 2000);
        console.error("EXPORTATRUST_GMAIL_HOURLY_SYNC_FAILED", {
          organizationId: identity.organization_id,
          userId: identity.user_id,
          status: response.status,
          body,
        });
      }
    } catch (error) {
      console.error("EXPORTATRUST_GMAIL_HOURLY_SYNC_ERROR", {
        organizationId: identity.organization_id,
        userId: identity.user_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (controller.cron !== "0 * * * *") return;
    ctx.waitUntil(runHourlyGmailSync(env, ctx));
  },
};

export default worker;
