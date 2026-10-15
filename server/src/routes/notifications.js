import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { authRequired } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { parseBody } from '../utils/validators.js';

export const notificationsRouter = Router();
notificationsRouter.use(authRequired);

notificationsRouter.get('/', asyncHandler(async (req, res) => {
  const result = await query(
    `WITH visible_students AS (
       SELECT u.id, u.name FROM users u WHERE u.role = 'student' AND (
         $2 = 'admin' OR ($2 = 'student' AND u.id = $1) OR
         ($2 = 'personal' AND EXISTS (
           SELECT 1 FROM trainer_students ts WHERE ts.student_id = u.id AND ts.trainer_id = $1
         ))
       )
     ), items AS (
       SELECT 'feedback:' || wf.id AS id, 'feedback' AS type, s.id AS "studentId",
              'Dúvida de ' || s.name AS title,
              concat_ws(' — ', wf.difficulty, wf.message) AS description, wf.created_at AS "createdAt"
       FROM workout_feedback wf JOIN visible_students s ON s.id = wf.student_id
       WHERE $2 <> 'student' AND NOT wf.is_plan_completed
         AND (wf.difficulty IS NOT NULL OR wf.message <> 'Treino do dia concluido')
       UNION ALL
       SELECT 'assessment:' || ar.id, 'assessment', s.id,
              'Avaliação pendente',
              CASE WHEN $2 = 'student' THEN 'Preencha sua avaliação solicitada.'
                   ELSE s.name || ' ainda precisa preencher a avaliação.' END, ar.created_at
       FROM assessment_requests ar JOIN visible_students s ON s.id = ar.student_id
       JOIN users requester ON requester.id = ar.requested_by
       WHERE ar.completed_at IS NULL AND (requester.role = 'admin' OR EXISTS (
         SELECT 1 FROM trainer_students ts
         WHERE ts.student_id = ar.student_id AND ts.trainer_id = ar.requested_by
       ))
       UNION ALL
       SELECT 'billing:' || b.student_id || ':' || b.updated_at::text, 'payment', s.id,
              'Pagamento ' || CASE WHEN b.status = 'overdue' OR b.due_date < CURRENT_DATE
                                  THEN 'em atraso' ELSE 'pendente' END,
              s.name || ' — Mensalidade' || COALESCE(' R$ ' || b.monthly_amount::text, '') ||
                COALESCE(' — Vencimento: ' || to_char(b.due_date, 'DD/MM/YYYY'), ''), b.updated_at
       FROM student_billing b JOIN visible_students s ON s.id = b.student_id
       WHERE b.status IN ('pending', 'overdue') AND (b.due_date IS NOT NULL OR b.monthly_amount > 0)
       UNION ALL
       SELECT 'payment:' || p.id, 'payment', s.id,
              'Pagamento ' || CASE WHEN p.status = 'overdue' OR p.due_date < CURRENT_DATE
                                  THEN 'em atraso' ELSE 'pendente' END,
              s.name || ' — Parcela' || COALESCE(' R$ ' || p.amount::text, '') ||
                COALESCE(' — Vencimento: ' || to_char(p.due_date, 'DD/MM/YYYY'), ''), p.created_at
       FROM student_payment_history p JOIN visible_students s ON s.id = p.student_id
       WHERE p.status IN ('pending', 'overdue')
     )
     SELECT items.*, (nr.notification_id IS NOT NULL) AS read
     FROM items LEFT JOIN notification_reads nr ON nr.user_id = $1 AND nr.notification_id = items.id
     ORDER BY "createdAt" DESC, items.id DESC`,
    [req.user.id, req.user.role]
  );
  res.json({ notifications: result.rows });
}));

notificationsRouter.post('/read', asyncHandler(async (req, res) => {
  const { ids } = parseBody(z.object({ ids: z.array(z.string().min(1).max(200)).max(500) }), req.body);
  await query(
    `INSERT INTO notification_reads (user_id, notification_id)
     SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`,
    [req.user.id, ids]
  );
  res.status(204).send();
}));
