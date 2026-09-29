import { requireSecurityContext } from "../../../../lib/security";
import type { R2MigrationManifest } from "../../../../lib/r2-migration";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Falha desconhecida.";
}

async function requireStaging() {
  const { env } = await import("cloudflare:workers");
  const appEnv = String((env as unknown as Record<string, unknown>).APP_ENV ?? "");
  if (appEnv !== "staging") {
    throw new Response(JSON.stringify({ error: "Importação R2 permitida somente em staging." }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  return env;
}

function decodeJsonHeader(value: string | null) {
  if (!value) return {};
  let normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  while (normalized.length % 4) normalized += "=";
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

async function listAll(bucket: R2Bucket) {
  const rows: Array<{ key: string; size: number; etag: string }> = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ limit: 1000, cursor });
    for (const item of page.objects) rows.push({ key: item.key, size: item.size, etag: item.etag });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return rows;
}

export async function GET() {
  try {
    await requireSecurityContext("export");
    await requireStaging();
    return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>ExportaTrust · Import R2</title></head>
<body style="font-family:system-ui;max-width:900px;margin:40px auto;padding:0 20px">
<h1>Importação integral R2 · Staging</h1>
<p>Extraia o arquivo TAR baixado da produção. Depois selecione a pasta extraída abaixo. O navegador localizará o manifesto e enviará os objetos um a um, preservando a chave R2 original.</p>
<input id="folder" type="file" webkitdirectory multiple>
<button id="scan">Validar pasta</button>
<button id="upload" disabled>Importar arquivos no R2</button>
<button id="check" disabled>Validar destino</button>
<pre id="out" style="white-space:pre-wrap;background:#f5f5f5;padding:16px;min-height:120px"></pre>
<script>
const folder=document.getElementById('folder'), out=document.getElementById('out');
const upload=document.getElementById('upload'), check=document.getElementById('check');
let manifest=null, fileMap=new Map();

function b64url(obj){
  const bytes=new TextEncoder().encode(JSON.stringify(obj||{}));
  let bin=''; for(const b of bytes) bin+=String.fromCharCode(b);
  return btoa(bin).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}
function findBySuffix(files,suffix){
  return files.find(f=>f.webkitRelativePath===suffix || f.webkitRelativePath.endsWith('/'+suffix));
}
document.getElementById('scan').onclick=async()=>{
  try{
    const files=[...folder.files];
    const mf=findBySuffix(files,'exportatrust-r2-manifest.json');
    if(!mf) throw new Error('Manifesto exportatrust-r2-manifest.json não encontrado.');
    manifest=JSON.parse(await mf.text());
    if(manifest.format!=='ExportaTrust Full R2 Export v1') throw new Error('Formato de manifesto inválido.');
    fileMap=new Map();
    let missing=[];
    for(const item of manifest.objects){
      const f=findBySuffix(files,item.archivePath);
      if(!f) missing.push(item.archivePath);
      else if(f.size!==item.size) missing.push(item.archivePath+' (tamanho divergente)');
      else fileMap.set(item.archivePath,f);
    }
    out.textContent=JSON.stringify({ok:missing.length===0,objectCount:manifest.objectCount,totalBytes:manifest.totalBytes,filesFound:fileMap.size,missing:missing.slice(0,20)},null,2);
    upload.disabled=missing.length!==0;
    check.disabled=true;
  }catch(e){out.textContent=String(e);upload.disabled=true;check.disabled=true;}
};

async function putOne(item,file){
  const url='/api/admin/migration-r2-import?action=put&key='+encodeURIComponent(item.key)+'&size='+item.size;
  const res=await fetch(url,{method:'POST',headers:{
    'content-type':(item.httpMetadata&&item.httpMetadata.contentType)||file.type||'application/octet-stream',
    'x-exportatrust-http-metadata':b64url(item.httpMetadata||{}),
    'x-exportatrust-custom-metadata':b64url(item.customMetadata||{})
  },body:file});
  const text=await res.text();
  if(!res.ok) throw new Error(text);
  return JSON.parse(text);
}
upload.onclick=async()=>{
  if(!manifest) return;
  upload.disabled=true; check.disabled=true;
  let done=0, skipped=0, failed=[];
  const items=[...manifest.objects];
  for(let i=0;i<items.length;i+=3){
    const batch=items.slice(i,i+3);
    const results=await Promise.allSettled(batch.map(async item=>{
      const r=await putOne(item,fileMap.get(item.archivePath));
      if(r.skipped) skipped++;
      done++;
      out.textContent='Importando R2... '+done+'/'+manifest.objectCount+'\nIgnorados por já existirem com mesmo tamanho: '+skipped+'\nFalhas: '+failed.length;
      return r;
    }));
    results.forEach((r,j)=>{if(r.status==='rejected')failed.push({key:batch[j].key,error:String(r.reason)});});
    if(failed.length){out.textContent=JSON.stringify({ok:false,done,skipped,failed:failed.slice(0,20)},null,2);upload.disabled=false;return;}
  }
  out.textContent=JSON.stringify({ok:true,uploadedOrVerified:done,skipped,total:manifest.objectCount,next:'Clique em Validar destino.'},null,2);
  check.disabled=false;
};
check.onclick=async()=>{
  if(!manifest)return;
  out.textContent='Validando destino...';
  const res=await fetch('/api/admin/migration-r2-import?action=validate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(manifest)});
  out.textContent=await res.text();
};
</script></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: errorText(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireSecurityContext("export");
    const env = await requireStaging();
    if (!env.BUCKET) return Response.json({ error: "R2 indisponível." }, { status: 503 });

    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    if (action === "put") {
      const key = url.searchParams.get("key") ?? "";
      const expectedSize = Number(url.searchParams.get("size") ?? "-1");
      if (!key || !Number.isFinite(expectedSize) || expectedSize < 0) {
        return Response.json({ error: "Chave ou tamanho inválido." }, { status: 400 });
      }

      const current = await env.BUCKET.head(key);
      if (current && current.size === expectedSize) {
        return Response.json({ ok: true, key, size: current.size, skipped: true });
      }

      const httpMetadata = decodeJsonHeader(request.headers.get("x-exportatrust-http-metadata"));
      const customMetadata = decodeJsonHeader(request.headers.get("x-exportatrust-custom-metadata")) as Record<string, string>;
      if (!request.body) return Response.json({ error: "Corpo do arquivo ausente." }, { status: 400 });
      const result = await env.BUCKET.put(key, request.body, {
        httpMetadata: httpMetadata as R2HTTPMetadata,
        customMetadata,
      });
      if (!result || result.size !== expectedSize) {
        return Response.json({ error: "Upload concluído com tamanho divergente.", key, expectedSize, actual: result?.size ?? null }, { status: 409 });
      }
      return Response.json({ ok: true, key, size: result.size, etag: result.etag, skipped: false });
    }

    if (action === "validate") {
      const manifest = await request.json() as R2MigrationManifest;
      if (manifest.format !== "ExportaTrust Full R2 Export v1" || !Array.isArray(manifest.objects)) {
        return Response.json({ error: "Manifesto R2 inválido." }, { status: 400 });
      }
      const actual = await listAll(env.BUCKET);
      const actualMap = new Map(actual.map(item => [item.key, item]));
      const missing: Array<{ key: string; expectedSize: number }> = [];
      const sizeMismatches: Array<{ key: string; expected: number; actual: number }> = [];
      for (const expected of manifest.objects) {
        const got = actualMap.get(expected.key);
        if (!got) missing.push({ key: expected.key, expectedSize: expected.size });
        else if (got.size !== expected.size) sizeMismatches.push({ key: expected.key, expected: expected.size, actual: got.size });
      }
      const expectedKeys = new Set(manifest.objects.map(item => item.key));
      const extras = actual.filter(item => !expectedKeys.has(item.key));
      const totalBytes = actual.reduce((sum,item)=>sum+item.size,0);
      const expectedBytes = manifest.objects.reduce((sum,item)=>sum+item.size,0);
      const ok = missing.length===0 && sizeMismatches.length===0 && extras.length===0 && actual.length===manifest.objectCount && totalBytes===expectedBytes;
      return Response.json({
        ok,
        mode: "validate-r2",
        expectedObjectCount: manifest.objectCount,
        actualObjectCount: actual.length,
        expectedTotalBytes: expectedBytes,
        actualTotalBytes: totalBytes,
        missing: missing.slice(0,50),
        sizeMismatches: sizeMismatches.slice(0,50),
        extras: extras.slice(0,50),
      }, { status: ok ? 200 : 409 });
    }

    return Response.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ ok: false, error: errorText(error) }, { status: 500 });
  }
}
