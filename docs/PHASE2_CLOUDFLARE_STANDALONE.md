# Fase 2 — Cloudflare Standalone

## Objetivo

Executar o ExportaTrust fora do ChatGPT Sites mantendo a arquitetura nativa atual:
- Cloudflare Workers
- D1
- R2
- Wrangler
- Vite / vinext

O ambiente ChatGPT Sites permanece como produção de referência até homologação completa.

## Estratégia

A configuração externa é ativada somente quando:

`EXPORTATRUST_EXTERNAL=1`

Sem essa variável, o build atual do ChatGPT Sites continua usando `.openai/hosting.json` e o comportamento existente.

Com a variável ativa, o Vite usa:

`wrangler.external.jsonc`

Isso permite construir e publicar um Worker standalone sem alterar a configuração do site atual.

## Ambientes

### staging

Worker:
`exportatrust-staging`

Bindings:
- D1: `DB`
- R2: `BUCKET`

`APP_ENV=staging`

Os recursos de staging devem ser separados dos recursos de produção.

### production

Worker:
`exportatrust-production`

Bindings:
- D1: `DB`
- R2: `BUCKET`

`APP_ENV=production`

Produção externa só deve ser criada depois da homologação do staging.

## Scripts

Build de staging:

`npm run build:external:staging`

Deploy de staging:

`npm run deploy:external:staging`

Deploy de produção:

`npm run deploy:external:production`

## Regra de segurança

Na primeira implantação externa:
- não apontar para o D1 atual do ChatGPT Sites;
- não apontar para o R2 atual do ChatGPT Sites;
- criar recursos de staging próprios;
- importar cópias somente depois da validação da infraestrutura;
- nunca substituir ou apagar os recursos de origem.

## Próximo passo operacional

1. criar/autorizar conta Cloudflare;
2. executar deploy de staging;
3. deixar Wrangler provisionar ou conectar um D1 e R2 próprios;
4. obter URL `*.workers.dev`;
5. validar que a aplicação abre;
6. somente depois importar uma cópia do histórico.
