# Cadastro de e-mail / primeiro acesso

2026-10-15 · `codex/self-registration` → `homologation`.

A tela `/__auth/login` oferece **Primeiro acesso? Cadastrar e-mail**, levando a
`/__auth/cadastrar`. A pessoa informa nome, e-mail e código da empresa (slug).
O administrador encontra esse código e as solicitações em **Cadastros → Equipe**.
O resultado público é o mesmo para empresa desconhecida ou pessoa já cadastrada,
sem confirmar a existência de contas/empresas.

O administrador confere a identidade, seleciona **Revisar cadastro**, escolhe o
perfil e usa **Liberar acesso**. O fluxo existente de convite é preservado e gera
automaticamente o link privado de senha, de uso único por 72 horas. Deve entregar
o link somente ao destinatário confirmado; **não há envio automático de e-mail**.
A pessoa define a senha e volta para entrar. O cadastro público nunca cria vínculo,
perfil, sessão ou credencial, nem modifica senhas existentes ou reativa membros.
Membros já existentes usam o link de senha da Equipe.

Tabela nova aditiva `railway_access_requests`: id, organization_id, email,
full_name, created_at, unique(organization_id, email). Solicitações já vinculadas
não aparecem como pendentes. A tabela precisa entrar no backup integral privado
do PostgreSQL; não integra o exportador D1. Nenhum dado de negócio é substituído.
Rate limit por IP/processo, limite de corpo, validação de campos, POST com Origin,
escape HTML e CSP das telas de autenticação permanecem aplicáveis.

Solicitações são visíveis apenas ao administrador da empresa selecionada, após
revalidação de sessão/vínculo. Não há listagem pública ou concessão automática.
O primeiro administrador continua dependendo do bootstrap já configurado ou de
Google verificado e configurado. Este formulário não resolve o acesso inicial do
proprietário sozinho e não cria um administrador pela posse declarada de um e-mail.

Google permanece no fluxo existente. Client ID/secret ainda precisam ser salvos
no Railway pelo responsável, conforme `GOOGLE_LOGIN.md`; não é ativado apenas por
digitar um endereço Gmail.

Validação: build Railway, suíte com PostgreSQL embarcado/PGlite e lint dos arquivos
alterados. Testes cobrem cadastro duplicado/inválido, empresa desconhecida,
isolamento entre empresas, recusa de não administrador, ausência de credenciais
criadas publicamente e aprovação → link privado → senha → login. Teste manual
autenticado da Equipe permanece pendente; produção não autorizada.

Rollback: reverter somente o PR e preservar solicitações/credenciais no banco.
