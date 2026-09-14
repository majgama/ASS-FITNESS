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

## Hotmart

O endpoint inicial de webhook e:

```text
POST /api/payments/hotmart/webhook
```

Configure `HOTMART_HOTTOK` com o token Hottok da conta. O sistema valida o header `X-HOTMART-HOTTOK`, registra o evento e libera mais alunos para o personal cujo e-mail de compra corresponde ao e-mail cadastrado no app.
