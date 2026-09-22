# ASS Fitness

Aplicativo web para gestao de assessoria fitness com tres perfis: administrador, personal trainer e aluno.

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Banco: PostgreSQL
- Auth: Bearer token opaco, hash SHA-256 em banco, bcrypt para senha, sessoes de 30 dias
- Uploads protegidos por rota autenticada

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
