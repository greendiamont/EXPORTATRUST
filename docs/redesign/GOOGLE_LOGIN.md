# Entrar com Google — homologação

2026-10-15 · Codex/Jarvis · PR #90 · `codex/google-login` → `homologation`.

## Estado

Código preparado para o login padrão solicitado por Ivam. **Não é possível
autenticar com Google enquanto o aplicativo OAuth não for configurado no Google
Cloud e suas credenciais não forem salvas nas variáveis do Railway.** Na leitura
inicial, o serviço não possuía `GOOGLE_LOGIN_*`.

Sem configuração completa o botão aparece desativado com mensagem clara; as
senhas individuais e o bootstrap anteriores continuam funcionando. Nenhum segredo
existente será substituído. Não reutilizar automaticamente OAuth do Gmail.

## Configuração necessária (somente homologação)

No projeto Google Cloud da empresa, configurar a marca/tela de consentimento e
criar um cliente OAuth do tipo **Aplicativo da Web**. Para contas de outras
organizações Google, o público precisa ser **Externo**. Enquanto estiver em modo
de testes, incluir os e-mails dos testadores (inclusive o escolhido por Ivam).
As restrições/revisão do Google continuam valendo; não confundir público externo
do provedor com permissão para os dados do ExportaTrust.

URI exata de redirecionamento:

`https://web-api-production-a92f.up.railway.app/__auth/google/callback`

Variáveis exclusivas de login, no `web-api` de homologação:

- `GOOGLE_LOGIN_CLIENT_ID`: ID do cliente OAuth criado no Google;
- `GOOGLE_LOGIN_CLIENT_SECRET`: segredo desse cliente; salvar diretamente no Railway,
  nunca em GitHub, chat, logs ou documentos;
- `GOOGLE_LOGIN_REDIRECT_URI`: URI acima;
- `GOOGLE_LOGIN_BOOTSTRAP_EMAIL`: endereço escolhido por Ivam para o primeiro
  acesso, configurado somente na infraestrutura da homologação.

As duas últimas podem ser preparadas sem credenciais. As duas primeiras dependem
do administrador da conta Google Cloud. O ID não é segredo, mas o client secret é.
Não criar credenciais falsas/placeholders no serviço.

## Acesso e proteção

- Biblioteca oficial `google-auth-library`: Authorization Code, PKCE S256,
  `state` e `nonce`. Cookie de transação assinado, HttpOnly, Secure, 10 minutos.
- Escopos somente `openid email profile`; nenhum acesso ao Gmail/Drive.
- Biblioteca verifica assinatura do ID token, emissor, audience e expiração;
  o app também valida nonce, subject e `email_verified`.
- Identidade é vinculada pelo `sub` Google em `railway_google_identities`. Não
  troca o vínculo se outro subject apresentar o mesmo e-mail ou vice-versa.
- Só usuários ativos com vínculo ativo em empresa ativa entram nos dados.
  Essa condição é revalidada em cada request. Uma conta Google desconhecida
  não ganha usuário, empresa, perfil ou acesso automaticamente.
- Exceção explícita de infraestrutura: na homologação, o e-mail exato configurado
  em `GOOGLE_LOGIN_BOOTSTRAP_EMAIL`, **após verificação pelo Google**, pode criar
  seu usuário e primeiro vínculo de administrador na organização 1. Nunca muda
  um perfil já existente e nunca reativa usuário/vínculo inativo. A variável é
  ignorada em produção. Removê-la depois do primeiro acesso verificado.
- Senhas Google, ID tokens e access tokens não são armazenados. Erros do
  provedor não são impressos para evitar vazamento de códigos/segredos.
- A nova tabela deve fazer parte do backup privado integral do PostgreSQL;
  não entra no exportador D1 que possui lista explícita de tabelas.

## Validação

- Testes automatizados de configuração incompleta, PKCE/state/nonce, callback,
  e-mail não verificado, assinatura inválida, cancelamento e botão indisponível.
- Integração PostgreSQL embarcado: conta sem vínculo recusada, vinculação por
  subject, conflito recusado, inativação imediata e bootstrap que não reativa.
- **Teste real de OAuth Google pendente** até existir cliente OAuth válido.
- Build Railway passou; 68 testes locais passaram com PostgreSQL embarcado/PGlite;
  ESLint dos arquivos alterados sem erros. Testes de tokens usam respostas
  controladas, não uma conta Google real.
- Homologação não implica autorização para produção.

## Checklist de ativação

1. Configurar o cliente Google e seus testadores; salvar ID/secret no Railway.
2. Confirmar redeploy e healthcheck; botão passa a ficar ativo.
3. Ivam entra com a conta Google correspondente ao e-mail escolhido.
4. Conferir usuário, empresa e perfil; remover bootstrap temporário.
5. Convidar outros usuários pela Equipe e testar conta autorizada/recusada,
   cancelamento, troca de conta e sign-out em desktop e celular.
6. Promover para produção somente após aprovação explícita e credenciais OAuth
   próprias para o domínio final.
