# ExportaTrust

Plataforma de controle de exportações, rastreabilidade e conformidade DDS/EUDR, com acompanhamento operacional do fornecedor ao cliente final.

[![ExportaTrust CI](https://github.com/greendiamont/EXPORTATRUST/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/greendiamont/EXPORTATRUST/actions/workflows/ci.yml)

## Visão geral

O ExportaTrust reúne em um único ambiente:

- cadastro mestre de fornecedores, clientes importadores, produtos e propriedades;
- processos de exportação com etapas operacionais STAGE 01–13;
- documentos por operação e conjunto final de embarque;
- Shipment Advice baseado nos dados reais do fornecedor e da operação;
- rastreabilidade, DDS/EUDR, SICAR, IBAMA e dossiês;
- timeline e trilha de auditoria;
- API segura do Agente Particular;
- integrações com Gmail, Asana e outras APIs;
- aprovações humanas obrigatórias para ações sensíveis.

O Agente Particular pode analisar eventos, localizar a operação pelo código do processo, sugerir atualizações, organizar documentos e preparar rascunhos. Envio ao cliente, alteração financeira, cancelamento, liberação de embarque e conclusão final exigem aprovação humana.

## Tecnologias

- TypeScript
- React 19
- Next.js 16
- Vinext / Vite
- Cloudflare Workers e D1
- Drizzle ORM
- Node.js 22
- GitHub Actions

## Estrutura principal

```text
app/                  Interface e rotas da API
app/api/agent/        Endpoints do Agente Particular
db/                   Schema e acesso ao banco
drizzle/              Migrações do banco de dados
lib/                  Regras de negócio e integrações
tests/                Testes automatizados
worker/               Entrada para Cloudflare Worker
```

## Desenvolvimento local

Requisitos:

- Node.js 22.13 ou superior
- npm
- ambiente Linux ou WSL recomendado

```bash
npm ci
npm run dev
```

Validação completa:

```bash
npm run lint
npm test
```

O comando `npm test` executa o build de produção e todos os testes automatizados.

## Fluxo de desenvolvimento

O repositório utiliza o seguinte fluxo:

1. `main`: versão principal e estável.
2. `develop`: integração das alterações aprovadas.
3. `feature/*`, `fix/*` ou `chore/*`: branches temporárias de trabalho.
4. Toda mudança deve entrar por Pull Request.
5. O Pull Request precisa passar pelos checks automáticos antes do merge.
6. Alterações sensíveis devem receber revisão humana.

Fluxo recomendado:

```text
feature/* ou fix/* → Pull Request → develop → Pull Request de release → main
```

## Checks automáticos

O GitHub Actions executa em cada Pull Request:

- instalação reprodutível das dependências;
- lint;
- build de produção;
- 28 testes automatizados;
- validações de persistência, segurança, auditoria e Agente Particular.

## Segurança

- Nunca versionar arquivos `.env`, tokens ou credenciais.
- Dados bancários são dados operacionais e não devem ser gravados em código.
- Credenciais das integrações devem ser armazenadas como secrets do ambiente.
- Documentos reais de clientes e fornecedores não devem ser incluídos no repositório.
- Ações críticas do agente permanecem sujeitas à aprovação humana.

## Aplicação

- Aplicação atual: [ExportaTrust EUDR](https://exportatrust-eudr.ivambona.chatgpt.site/)
- Código-fonte: [greendiamont/EXPORTATRUST](https://github.com/greendiamont/EXPORTATRUST)
- Branch de desenvolvimento: [develop](https://github.com/greendiamont/EXPORTATRUST/tree/develop)

## Licença e uso comercial

Código proprietário. Todos os direitos reservados. A reprodução, distribuição, sublicenciamento ou exploração comercial depende de autorização expressa do titular do ExportaTrust.


## Leitura de documentos com OpenAI

A rota autenticada `POST /api/ai/document-analysis` analisa um documento já armazenado no ExportaTrust. O corpo deve conter:

```json
{ "documentId": 123 }
```

A API:

- valida usuário, organização, operação e documento;
- lê o arquivo diretamente do armazenamento privado;
- aceita PDF, documentos Office, planilhas, texto e imagens;
- usa a Responses API com saída estruturada;
- não disponibiliza URL pública do documento;
- não armazena a resposta na OpenAI (`store: false`);
- registra a análise na trilha de auditoria;
- retorna parecer informativo sujeito à aprovação humana.

Variáveis de execução:

- `OPENAI_API_KEY`: secret obrigatório;
- `OPENAI_DOCUMENT_MODEL`: modelo configurável; padrão `gpt-5.6-terra`.

`GET /api/ai/document-analysis` informa apenas se a integração está configurada e nunca retorna o segredo.
