# Homologação — verificação inicial das abas (2026-10-15)

Autor: Codex/Jarvis. Base: `homologation` @ `01159728` (PR #90).
URL: https://web-api-production-a92f.up.railway.app/

## Resultado

**Ainda não aprovar produção.** Ambiente online; a navegação autenticada não pôde
ser validada porque o navegador está sem sessão e Google OAuth ainda não tem
client ID/secret. O usuário escolheu configurar essa integração por conta própria.
Não houve tentativa de remover a autenticação nem de acessar o Google Cloud.

## Verificações reais no Railway, sem login

| Área / rota | Resultado observado | Alcance da conclusão |
|---|---|---|
| `/api/health` | 200; DB e storage OK | Infraestrutura saudável |
| `/__auth/login` | 200; tela aberta no navegador | Formulário visível; Google desativado com aviso de configuração |
| `/__auth/google/start` | 503 | Bloqueio seguro até configurar OAuth; login real Google pendente |
| Painel `/` | 303 para login | Proteção de acesso; conteúdo interno não testado |
| Pedidos `/pedidos` | 303 para login | Busca, filtros e abertura de pedido ainda não testados no Railway |
| Novo processo `/novo-processo` | 303 para login | Cadastro e persistência ainda não testados no Railway |
| Cadastros `/cadastros` | 303 para login | Clientes/Fornecedores/Produtos/Florestas/Equipe aguardam sessão |
| EUDR `/classico` | 303 para login | A aba usa a versão clássica nesta etapa; fluxo interno pendente |
| Relatórios `/classico?module=Relatórios` | 303 para login | A aba usa a versão clássica nesta etapa; emissão interna pendente |
| `/api/overview`, `/api/security`, `/api/suppliers`, `/api/properties` | 401 | Não retornaram dados sem autenticação |
| `/api/importer-clients`, `/api/master-products` | **500 (falha encontrada)** | Deveriam retornar 401; correção nesta branch |

A rodada inicial contém 15 verificações HTTP: 13 no comportamento esperado e duas
falhas reais. Isso **não equivale a testar as abas por dentro**. Não foram criados
usuários, processos, cadastros ou documentos de teste na base hospedada.

## Falha corrigida

Os dois GETs de Clientes e Produtos deixavam escapar a `Response` lançada por
`requireSecurityContext`. O vinext converte a exceção não capturada em 500 (também
observado nos logs do Railway). Os handlers agora devolvem a resposta 401/403
original e tratam falhas reais de listagem separadamente.

Teste de regressão executa os **handlers reais compilados** sem identidade e
confere HTTP 401/JSON. Não troca permissões, consultas de dados, schema ou dados.

Correção no PR #91: build Railway, 69/69 testes (com PGlite, sem skips) e ESLint
dos arquivos alterados passaram localmente. O teste reproduziu o 500 antes da
correção e passou com 401 após recompilar os dois handlers. Revalidação hospedada
deve acontecer após o deploy desse PR; ela não substitui testar cadastros logados.

## Após liberar o login

1. Confirmar a pessoa, empresa e perfil corretos; testar Sair e conta sem vínculo.
2. Painel: conferir contagens contra os processos reais, Todas/Minhas e links de fase.
3. Pedidos: testar busca por cliente/fornecedor/produto, seis fases, valor e EUDR.
4. Novo processo: validar obrigatórios, cliente/produto, CAR por fornecedor,
   rascunho e persistência após recarregar. Fazer em dados claramente de teste,
   depois de decidir/concluir a importação inicial (que exige destino vazio).
5. Cadastros: testar criação/edição e conservação dos campos, duplicidades,
   dados bancários, completude e vínculos; inativação e permissões na Equipe.
6. EUDR/clássico: CAR, supply chain, anexos, processo UE e fora UE, dossiê/PDF.
7. Documentos/Relatórios: Sales Order, Purchase Invoice, pedido de compra,
   Packing List (visualização e DOCX), totais e dados cadastrais.
8. Validar mobile, teclado, erros, estados vazios e ausência de erros no console.
9. Conferir contagens e integridade da cópia dos dados/documentos antes do cutover.

## Pendências conhecidas

- OAuth Google não está ativo: exige configuração administrativa, não se resolve
  só tentando autenticar dentro do aplicativo.
- Migração/cópia de dados de produção ainda não foi confirmada nesta verificação.
- Novas telas de pedido/fases, emissão numerada de documentos, EUDR e financeiro
  ainda seguem as etapas futuras descritas em `docs/redesign/PLANO_REDESIGN.md`.
- Typecheck global possui baseline de 89 erros; não foi aprovado como verde.

Produção permanece intocada e qualquer promoção exige autorização explícita do Ivam.
