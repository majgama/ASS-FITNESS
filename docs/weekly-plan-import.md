# Importação administrativa de planos semanais

As rotas exigem Bearer token de administrador. O prefixo completo da API é `/api/workouts`:

| Método e rota | Resultado |
| --- | --- |
| `POST /api/workouts/weekly/import/validate` | HTTP 200 com `valid`, `matchedExercises`, `missingExercises` e `ambiguousExercises`; não grava dados. |
| `POST /api/workouts/weekly/import` | HTTP 201 com `{ "success": true, "weeklyPlan": ... }`, incluindo os sete dias e os treinos completos. |

Use [weekly-plan-import.example.json](weekly-plan-import.example.json) como payload. Esse exemplo usa os exercícios públicos do seed local, incluindo dois nomes com acentos que também resolvem os nomes sem acento do seed. Não execute o seed em um banco que foi deliberadamente limpo apenas para testar este exemplo: escolha nomes públicos disponíveis nesse banco.

## Contrato

- `name`: string com pelo menos dois caracteres; `description`: string opcional ou `null`.
- `days`: de um a sete dias distintos, com `dayOfWeek` inteiro entre 0 (domingo) e 6 (sábado).
- Dia ativo: `isRest` omitido ou `false`, `name` obrigatório, ao menos um item em `exercises` ou `cardio`. `description` e `instructions` são opcionais.
- Descanso: `isRest: true`, `instructions` opcional, sem exercícios/cardio. Dias omitidos viram descanso automaticamente.
- Musculação: `exerciseName` obrigatório; `sets`, `repetitions`, `load` e `notes` são strings opcionais ou `null`. `restSeconds` é inteiro entre 0 e 2147483647, opcional ou `null`.
- Cardio: `exerciseName` e `duration` são strings não vazias; `intensity` e `notes` são strings opcionais ou `null`.

Exercícios são resolvidos somente na biblioteca pública. A comparação ignora caixa e espaços repetidos; primeiro procura o nome com acentos preservados e, na ausência de correspondência, tenta remover marcas de acentuação. Mais de uma correspondência no nível escolhido é considerada ambígua. Não há busca aproximada por palavras semelhantes.

O dry run informa, para cada nome resolvido, `{ exerciseName, exerciseId, matchedName }`. Um resultado válido não reserva os exercícios: a importação verifica novamente dentro de uma transação.

Cardio é inserido depois da musculação, com posições sequenciais a partir de 1, `sets: "1"`, `repetitions: duration`, carga/descanso nulos e notas reunindo intensidade e observações. Exercícios repetidos podem aparecer em posições diferentes com o mesmo UUID.

O plano e os treinos criados são sempre públicos, sem proprietário e com `created_by` igual ao administrador autenticado. Campos enviados de visibilidade/proprietário não mudam essa regra. O importador não cria exercícios nem copia mídias; a resposta usa os joins existentes para retornar as mídias originais.

## Erros

Segue o envelope de erros existente da API. Exemplo de HTTP 400 quando faltam exercícios:

```json
{
  "error": {
    "code": "EXERCISES_NOT_FOUND",
    "message": "Exercicios publicos nao encontrados.",
    "details": {
      "matchedExercises": [],
      "missingExercises": ["Nome não cadastrado"],
      "ambiguousExercises": []
    }
  }
}
```

Nomes ambíguos retornam HTTP 409 com `error.code: "EXERCISES_AMBIGUOUS"` e a lista em `error.details.ambiguousExercises`. Payload inválido retorna HTTP 400 (`BAD_REQUEST`); falta de autenticação, HTTP 401; personal/aluno, HTTP 403. Nenhuma falha deixa planos ou treinos parciais. Os dados existentes permanecem intactos.

## Testar localmente

Prepare o ambiente conforme o README, com PostgreSQL local, dependências instaladas, schema aplicado e API em execução por `npm run dev`. O exemplo precisa que os nomes referenciados existam na biblioteca pública.

O procedimento abaixo usa o administrador de desenvolvimento definido em `server/.env` (ou os padrões locais), valida o JSON, importa um plano e imprime a resposta. Execute somente no banco local pretendido. A importação bem-sucedida cria um novo plano e novos treinos a cada chamada; não é uma operação idempotente. Se a senha do administrador foi alterada, use a credencial local correspondente na configuração antes do teste.

Na raiz do repositório:

```bash
cd server
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { env } from './src/config/env.js';

const base = `http://127.0.0.1:${env.port}/api`;
const payload = JSON.parse(await readFile('../docs/weekly-plan-import.example.json', 'utf8'));
const login = await fetch(`${base}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: env.seedAdminEmail, password: env.seedAdminPassword })
});
assert.equal(login.status, 200, 'Login administrativo falhou');
const { token } = await login.json();
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
try {
  const validation = await fetch(`${base}/workouts/weekly/import/validate`, {
    method: 'POST', headers, body: JSON.stringify(payload)
  });
  const result = await validation.json();
  console.log(JSON.stringify(result, null, 2));
  assert.equal(validation.status, 200);
  assert.equal(result.valid, true, 'Corrija os nomes indicados antes de importar');
  const imported = await fetch(`${base}/workouts/weekly/import`, {
    method: 'POST', headers, body: JSON.stringify(payload)
  });
  const body = await imported.json();
  console.log(JSON.stringify(body, null, 2));
  assert.equal(imported.status, 201);
  assert.equal(body.success, true);
  assert.equal(body.weeklyPlan.days.length, 7);
} finally {
  await fetch(`${base}/auth/logout`, { method: 'POST', headers });
}
JS
```

## Testes automatizados

Os testes de importação usam PostgreSQL real. Exigem `WORKOUT_IMPORT_TEST_DATABASE_URL` apontando explicitamente para PostgreSQL local e permissão de criar um schema temporário. Todas as fixtures e falhas simuladas ficam nesse schema aleatório, removido ao terminar; o schema da aplicação não é alterado. Sem essa variável a suíte de integração aparece como ignorada, não como aprovada.

Na raiz do repositório, usando o PostgreSQL local do Docker Compose:

```bash
WORKOUT_IMPORT_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ass_fitness \
  node --experimental-test-module-mocks --test \
  client/src/pages/pageHelpers.test.js \
  server/src/db/clearTestData.test.js \
  server/src/services/exerciseFileAccess.test.js \
  server/src/routes/adminDeletion.test.js \
  server/src/routes/workoutCopy.test.js \
  server/src/routes/workoutsDaily.test.js \
  server/src/routes/weeklyImport.test.js
npm run build
```

Os 12 testes de importação verificam autorização, contrato, resolução de nomes, UUIDs e mídias, ordem e cardio, descanso, dry run, exercícios privados/ausentes, ambiguidades, rollback real em duas etapas e compatibilidade das três rotas existentes.
