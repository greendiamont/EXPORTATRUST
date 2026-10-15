# Primeiro acesso por CNPJ

2026-10-15 · `codex/cnpj-onboarding` → `homologation`.

Evolui o PR #92 por instrução explícita de Ivam: CNPJ substitui o código/slug e
cadastro inicial cria empresa e administrador. Substitui o fluxo de primeiro
administrador descrito em PRIMEIRO_ACESSO.md.

## Empresa nova

`/__auth/cadastrar`: CNPJ, nome da empresa, nome da pessoa, e-mail, senha e
confirmação. Transação cria organização própria, usuário novo, vínculo de
administrador, hash scrypt e reserva do CNPJ. Cria sessão e seleciona a empresa.
CNPJ numérico validado por dígitos verificadores; com/sem pontuação. Salvo
normalizado em organizations.tax_id. Slug interno `cnpj-{CNPJ}`.

Tabela aditiva railway_company_registrations (cnpj PK, organization_id unique,
created_at) impede duas inscrições para o mesmo CNPJ. Busca também tax_id legado
formatado. Empresa existente (inclusive inativa) não pode ser recadastrada.
E-mail existente não ganha senha/vínculo público, mesmo sem credencial individual.
Falhas revertem usuário, empresa, vínculo, credencial e reserva conjuntamente.
Sequência de organizations alinhada sem recuar sob lock breve, protegendo o seed
id 1 explícito da migração inicial. Nenhum registro anterior é modificado.

Empresa nova começa vazia e isolada: não copia nem move dados, processos ou
documentos da organização 1 ou de outras empresas. CNPJ/e-mail são declarações;
sem consulta à Receita nem envio de verificação de e-mail. Não comprovam
propriedade jurídica. Revisar titularidade/verificação antes de abertura pública.

## Equipe

Minha empresa já está cadastrada abre `/__auth/cadastrar?mode=team`: CNPJ, nome e
e-mail, sem senha. Administrador revisa em Cadastros → Equipe, escolhe perfil e
libera acesso, gerando link privado de senha (uso único, 72h). Deve entregar ao
destinatário confirmado. Sem envio automático de e-mail. Conta/vínculo inativo
não é reativado pela solicitação pública. Resposta genérica não revela empresas.
Solicitações anteriores por slug preservadas por organization_id. Empresas
legadas sem tax_id precisam cadastrar CNPJ antes de receber solicitações por ele.

## Olho de senha

Login, cadastro, definição e confirmação de senha têm botão Mostrar/Ocultar:
type=button, aria-controls/aria-pressed, teclado e campo inicialmente oculto.
Script próprio `/__auth/password-visibility.js`, permitido pela CSP. Não armazena
ou transmite a senha. Sem JS, formulários continuam funcionando com senha oculta.
Rate limit, CSRF Origin, limite de corpo, escape HTML, no-store e no-referrer
preservados. Erros mantêm apenas campos não secretos; nunca reexibem a senha.

Google continua dependendo das credenciais externas em GOOGLE_LOGIN.md, mas não
é necessário para cadastro por CNPJ + senha. Backups integrais privados devem
incluir solicitações, reservas de CNPJ e tabelas de auth, ausentes do export D1.

## Validação

Build Railway, 72 testes PGlite sem skips, lint. Testes cobrem novo administrador,
senha/sessão, CNPJ formatado/inválido, duplicidade de empresa/e-mail, concorrência,
rollback, seed id 1, isolamento e revogação. Teste da alternância do olho e
regressões de convites/Google. Cadastro manual pelo Ivam permanece pendente.
Somente homologação, produção não autorizada. Rollback preserva todas as tabelas,
empresas, usuários, credenciais e documentos, revertendo apenas o código.
