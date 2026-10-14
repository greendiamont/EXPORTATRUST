#!/usr/bin/env bash
# Build do ExportaTrust para o runtime Node do Railway (server/railway/server.mjs).
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_root}"

# O cache de fontes em .vinext/fonts foi gerado no ChatGPT Sites e referencia
# caminhos absolutos daquela máquina (/workspace/sites/...). O vinext só reescreve
# URLs sob a raiz atual do projeto; sem este ajuste as fontes Geist dão 404.
# Os arquivos originais são restaurados ao final para não alterar o repositório.
backup_dir="$(mktemp -d)"
restore_fonts() {
  cp -R "${backup_dir}/fonts/." .vinext/fonts/ 2>/dev/null || true
  rm -rf "${backup_dir}"
}
cp -R .vinext/fonts "${backup_dir}/fonts"
trap restore_fonts EXIT

for css in .vinext/fonts/*/style.css; do
  [[ -f "${css}" ]] || continue
  sed -i -E "s#url\\([^)]*/\\.vinext/fonts/#url(${project_root}/.vinext/fonts/#g" "${css}"
done

npm run build
