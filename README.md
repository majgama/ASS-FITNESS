# ASS Fitness

Aplicativo web para gestao de assessoria fitness com tres perfis: administrador, personal trainer e aluno.

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Banco: PostgreSQL
- Auth: Bearer token opaco, hash SHA-256 em banco, bcrypt para senha, sessoes de 30 dias
- Uploads protegidos por rota autenticada

## Interface

- Tema escuro com titulos claros e destaques dourados.
- Botoes de abrir e recolher o menu mobile com fundo preto, borda e icones dourados.
- Botoes com X para fechar modais e o popup da biblioteca de GIFs usam fundo preto, borda e icone dourados, inclusive ao passar o mouse, com foco visivel pelo teclado.
- Evolucao do treino exibida apenas em percentual na lista e na gestao do aluno, sem barra ou contagem de atividades.
- Catalogo de GIFs: 377 nomes de abdominais masculinos substituidos pela lista fornecida em 02/10/2026, incluindo os 17 marcados para revisao. IDs, imagens e demais campos foram preservados. Nomes personalizados pelo administrador continuam tendo prioridade; exercicios e planos ja salvos nao sao renomeados retroativamente.

Os players do YouTube usam `strict-origin-when-cross-origin` nos frames e no header `Referrer-Policy` do servidor. Essa politica envia apenas a origem ao YouTube, permitindo identificar a aplicacao e evitando o erro 153 sem expor o caminho ou os parametros da pagina. Proxies de producao devem preservar essa politica.

### Exclusoes pelo administrador

- Em **Alunos** ou **Administracao**, o administrador pode excluir permanentemente um aluno e seus dados vinculados.
- Em **Administracao**, pode excluir um personal. Os alunos e os planos ja aplicados permanecem, mas o vinculo com esse personal e seus modelos privados de exercicios, treinos, planos e dietas sao removidos. Exercicios privados tambem sao retirados dos modelos que os utilizam. Os modelos publicos permanecem.
- Em **Treinos**, o administrador pode excluir exercicios, treinos diarios e planos semanais publicos ou privados de qualquer personal. As abas de modelos privados mostram todos os proprietarios ao administrador.
- Nos cards de treinos diarios, os exercicios vinculados e suas series, repeticoes, carga, descanso e observacoes aparecem diretamente. Administradores e proprietarios dos treinos podem adicionar exercicios pelo card, editar sua prescricao ou remove-los.
- No modal de edicao de exercicios, os icones de midia ficam acima do nome. Banco de GIFs e Favoritos abrem a biblioteca diretamente abaixo dos icones, dentro do formulario.
- Na biblioteca de GIFs, genero, ambiente e categoria usam botoes de selecao multipla, assim como os grupos musculares. Rotulos curtos como Polias, Barras, Halteres e Maquinas substituem os nomes longos. Opcoes do mesmo filtro somam resultados; filtros diferentes sao combinados. Clique novamente para desmarcar ou em Todos para limpar o grupo. Busca, favoritos, paginacao e PDF respeitam as selecoes.
- Genero e ambiente ficam na mesma linha sob a legenda branca Genero/Ambiente, sem botao Todos; clique nos botoes ativos para desmarcar. As demais legendas tambem sao brancas, e Favoritos tem o mesmo tamanho dos botoes de filtro.
- Personais podem salvar treinos e planos semanais publicos como copias particulares. A copia de um plano inclui treinos diarios e exercicios independentes, para edicao sem alterar os modelos publicos de origem.
- As exclusoes exigem confirmacao na interface e permissao no servidor. Personais nao podem excluir contas de alunos ou de outros personais.
- Planos aplicados sao snapshots e mantem seus dados e acesso a midias quando um modelo ou personal e excluido. Arquivos fisicos nao sao removidos por essas exclusoes.

### Avaliacoes preenchidas pelo aluno

Em **Avaliacoes**, o personal seleciona um aluno vinculado e clica em **Liberar avaliacao para o aluno**. Uma avaliacao pendente fica disponivel no portal e na tela de avaliacoes do aluno, sem abertura automatica. O aluno envia medidas, objetivo, observacoes e fotos pelo mesmo formulario; o envio conclui a solicitacao e entra no historico do personal. Apenas o proprio aluno pode responder a uma solicitacao ativa, e o vinculo com o personal e conferido novamente no envio. Existe apenas uma pendencia por aluno; solicitacoes de personais desvinculados ficam ocultas e sao substituidas quando uma nova avaliacao e liberada. O registro direto pelo personal permanece disponivel. O schema cria `assessment_requests` na inicializacao; nao e necessario seed.

### Link de divulgacao do personal

Em **Alunos > Link de divulgacao**, o personal encontra seu unico link permanente, com **Copiar** e **Compartilhar** ao lado. O link usa o codigo ja existente em `personal_profiles.invite_code`, nao expira e pode ser usado por varias pessoas, sem informar previamente o e-mail de cada aluno. No cadastro, a pessoa informa o proprio e-mail e fica vinculada automaticamente ao personal exibido na tela. Compartilhar usa o menu nativo quando disponivel e WhatsApp nos demais navegadores. Convites individuais antigos continuam sujeitos ao e-mail, validade e uso unico originais. O link deixa de funcionar se a conta do personal for excluida.

## Rodando localmente

1. Instale dependencias:

```bash
npm install
```

2. Suba um PostgreSQL local:

```bash
docker compose up -d
```

3. Configure ambiente:

```bash
copy server\.env.example server\.env
copy client\.env.example client\.env
```

4. Rode schema e admin inicial:

```bash
npm run db:migrate
npm run db:seed
```

5. Inicie frontend e backend:

```bash
npm run dev
```

Frontend: http://localhost:5173  
Backend: http://localhost:3333/api

### Modelos iniciais e limpeza dos testes

Administradores podem importar planos semanais por JSON na tela **Treinos > Planos semanais > Importar plano pelo JSON**: cole o conteúdo ou selecione um arquivo, verifique a prévia e confirme a importação. A prévia mostra os exercícios públicos existentes, os ausentes (criados automaticamente sem mídia) e nomes ambíguos, que impedem a importação. A rota é protegida para administradores e grava o plano completo em uma única transação.

Para importar o plano publico **Hipertrofia Intermediario 5 Dias + Cardio** pelo console do servidor da DigitalOcean como alternativa, com `DATABASE_URL` e `DATABASE_SSL` configurados, execute primeiro `npm run db:import-intermediate-plan`. Essa consulta mostra os exercicios publicos correspondentes, os ausentes (que serao criados automaticamente sem midia) e os ambiguos, sem alterar dados. O comando reutiliza o mesmo servico do importador administrativo JSON, ignorando caixa, espacos repetidos e, como segunda tentativa, acentos. Revise os nomes que serao criados na pre-visualizacao; ambiguidades bloqueiam a gravacao.

Apos conferir o banco, fazer backup e revisar os nomes ausentes que serao criados, execute `npm run db:import-intermediate-plan -- --confirm-import`. A importacao grava em uma unica transacao e verifica o conteudo completo: exercicios publicos ausentes sem midia, 7 dias, 5 treinos, 21 prescricoes de musculacao e 5 de cardio. Cardio usa series `1`, duracao em repeticoes, carga/descanso nulos e intensidade nas observacoes. Nao modifica exercicios existentes, preservando suas midias, nem recria o plano iniciante. Reexecutar o comando nao duplica um plano identico; um plano existente com conteudo diferente gera erro sem sobrescrita. Treinos novos sao exclusivos deste plano, mesmo que outros modelos tenham nomes iguais. E necessario um administrador cadastrado; o mais antigo e registrado como autor. Nao ha importacao automatica no inicio do servidor.

O servidor e `db:migrate` nao recriam modelos de treino. Somente `npm run db:seed` cria ou completa o plano iniciante e seus treinos/exercicios publicos. Nao execute esse seed apos limpar o banco se desejar manter os modelos vazios.

Para limpar os testes em producao:

1. Publique esta versao, pare temporariamente as instancias da aplicacao e faca um backup/snapshot do banco.
2. No ambiente do servidor, com `DATABASE_URL` e `DATABASE_SSL` configurados, confira o banco e as contagens sem excluir nada:

```bash
npm run db:clear-test-data
```

3. Depois de conferir o banco, execute a exclusao explicitamente:

```bash
npm run db:clear-test-data -- --confirm-delete-all-test-data
```

A limpeza exclui **todos** os alunos (contas de papel `student`), seus dados vinculados (planos aplicados, feedback, avaliacoes, pagamentos e sessoes) e **todos** os modelos publicos/privados de planos semanais, treinos diarios e exercicios. Administradores, personais, a biblioteca de GIFs e os arquivos fisicos de midia permanecem. Planos de dieta de administradores/personais nao sao excluidos. A operacao usa uma transacao e verifica que os dados foram removidos e as contas de administradores/personais ficaram intactas; qualquer falha desfaz a limpeza. Reinicie a aplicacao apos concluir.

## Admin inicial

O seed cria o usuario definido em `server/.env`:

- E-mail: `admin@assfitness.local`
- Senha: `Admin@12345`

Troque esses valores antes de colocar em producao.

## DigitalOcean

Use `DATABASE_URL` do PostgreSQL gerenciado e defina `DATABASE_SSL=true`. Para arquivos, configure um volume persistente ou mova `UPLOAD_DIR` para um storage privado.

### App Platform em um unico servico

Build command:

```bash
npm install && npm run build
```

Run command:

```bash
npm start
```

Variaveis principais:

```env
NODE_ENV=production
APP_URL=https://seu-app.ondigitalocean.app
CORS_ORIGIN=https://seu-app.ondigitalocean.app
VITE_API_URL=/api
DATABASE_URL=postgresql://usuario:senha@host:porta/banco?sslmode=require
DATABASE_SSL=true
GIF_LIBRARY_DIR=/opt/ASS-FITNESS/gif
GIF_LIBRARY_PUBLIC_URL=http://174.138.44.33/gif
UPLOAD_DIR=/opt/ASS-FITNESS/server/src/uploads
UPLOAD_PUBLIC_URL=http://174.138.44.33/uploads
```

Em producao o Express serve o frontend compilado em `client/dist`. As rotas da API continuam em `/api`.

`GIF_LIBRARY_PUBLIC_URL` e `UPLOAD_PUBLIC_URL` apontam para os arquivos persistidos fora do App Platform. O backend retransmite esses arquivos pelo proprio dominio HTTPS da aplicacao, evitando bloqueios de mixed content no navegador.

## Hotmart

O endpoint inicial de webhook e:

```text
POST /api/payments/hotmart/webhook
```

Configure `HOTMART_HOTTOK` com o token Hottok da conta. O sistema valida o header `X-HOTMART-HOTTOK`, registra o evento e libera mais alunos para o personal cujo e-mail de compra corresponde ao e-mail cadastrado no app.
