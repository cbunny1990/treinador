const { test, expect } = require('@playwright/test');

for (const width of [390, 1440]) test(`planos passados ficam no histórico sem inferir realização · ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/#/treinos');
  const ids = await page.evaluate(async () => {
    RemoteWorkspace.scheduleSync = () => {};
    const date = (days) => { const d = new Date(TrainingPlanner.localDate() + 'T12:00:00'); d.setDate(d.getDate() + days); return TrainingPlanner.localDate(d); };
    const create = (data, objetivo, session) => DB.criar('treinos', { team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data, objetivo, status: 'ready', blocos: [], ...(session ? { session: { status: session } } : {}) });
    const old = await create(date(-3), 'Plano anterior sem sessão');
    await create(date(-2), 'Treino concluído', 'completed');
    await create(date(-1), 'Sessão ainda em pausa', 'paused');
    await create(date(2), 'Próximo treino');
    await router();
    return { old };
  });
  const history = page.getByRole('heading', { name: 'Histórico' }).locator('..');
  const upcoming = page.getByRole('heading', { name: 'Em curso e próximos' }).locator('..');
  await expect(history.getByText('Plano anterior sem sessão')).toBeVisible();
  const oldCard = history.locator('.training-card').filter({ hasText: 'Plano anterior sem sessão' });
  await expect(oldCard).toContainText('Plano passado');
  await expect(oldCard.locator('.badge')).toHaveClass(/system/);
  expect(await oldCard.evaluate(card => card.querySelector('.meta').getBoundingClientRect().top >= card.querySelector('.title').getBoundingClientRect().bottom)).toBe(true);
  await expect(history.locator('.training-card').filter({ hasText: 'Treino concluído' })).toContainText('Terminado');
  await expect(upcoming.locator('.training-card').filter({ hasText: 'Sessão ainda em pausa' })).toContainText('Em pausa');
  await expect(upcoming.locator('.training-card').filter({ hasText: 'Próximo treino' })).toContainText('Pronto');
  await history.locator('.training-card').filter({ hasText: 'Plano anterior sem sessão' }).click();
  await expect(page.getByText('Não há uma sessão em campo terminada')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Plano passado')).toBeVisible();
  const saved = await page.evaluate(async (id) => DB.obter('treinos', id), ids.old);
  expect(saved.status).toBe('ready');
  expect(saved.session?.status).toBeFalsy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  page.on('dialog', dialog => dialog.accept());
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Confirmar que o treino aconteceu' }).click();
  await expect(page.getByText('Realizado sem cronómetro', { exact: true })).toBeVisible();
  let occurrence = await page.evaluate(async id => DB.obter('treinos', id), ids.old);
  expect(occurrence.status).toBe('completed');
  expect(occurrence.session?.status).toBeFalsy();
  expect(occurrence.review).toBeUndefined();
  await page.getByRole('link', { name: 'Treino em campo / presenças' }).click();
  await expect(page.getByRole('button', { name: 'Iniciar treino' })).toHaveCount(0);
  await expect(page.getByText('Não foram atribuídos minutos')).toBeVisible();
  await page.getByRole('link', { name: 'Ficha do treino' }).click();
  await page.locator('form[data-form="training-review"] textarea[name="conclusao"]').fill('Texto ainda por guardar');
  await page.getByRole('button', { name: 'Anular confirmação de realização' }).click();
  await expect(page.getByText('Guarda a avaliação antes de alterar o estado')).toBeVisible();
  await expect(page.locator('form[data-form="training-review"] textarea[name="conclusao"]')).toHaveValue('Texto ainda por guardar');
  await page.context().setOffline(false);
  await page.reload();
  await page.getByRole('button', { name: 'Anular confirmação de realização' }).click();
  await expect(page.getByText('Plano passado')).toBeVisible();
  occurrence = await page.evaluate(async id => DB.obter('treinos', id), ids.old);
  expect(occurrence.status).toBe('ready');
  expect(occurrence.manual_completion.history.map(event => event.action)).toEqual(['confirm', 'retract']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('biblioteca guarda montagem e passos para consulta e plano exportado', async ({ page }) => {
  await page.goto('/#/exercicios/novo');
  await page.evaluate(() => { RemoteWorkspace.scheduleSync = () => {}; });
  await page.getByLabel('Nome').fill('Circuito montagem E2E');
  await page.getByLabel('Montagem / organização do exercício').fill('Quatro cones num quadrado de 12 metros.');
  await page.getByLabel('Passo a passo · um passo por linha').fill('Conduzir até ao cone.\nPassar ao colega.\nMudar de posição.');
  await page.getByRole('button', { name: 'Guardar exercício' }).click();

  await expect(page.locator('#app').getByRole('heading', { name: 'Circuito montagem E2E' })).toBeVisible();
  await expect(page.getByText('Quatro cones num quadrado de 12 metros.')).toBeVisible();
  await expect(page.getByText('Conduzir até ao cone.')).toBeVisible();
  const exercise = await page.evaluate(async () => (await DB.listar('exercicios')).find(row => row.nome === 'Circuito montagem E2E'));
  expect(exercise.montagem).toBe('Quatro cones num quadrado de 12 metros.');
  expect(exercise.passos).toEqual(['Conduzir até ao cone.', 'Passar ao colega.', 'Mudar de posição.']);
  await page.evaluate(async id => DB.modificar('exercicios', id, row => ({ ...row, external_key: 'exercise-ativacao-conduzir-passar-dar-opcao' })), exercise.id);

  await page.getByRole('link', { name: 'Usar num treino' }).click();
  await page.getByLabel('Objetivo da sessão').fill('Criar linhas de passe');
  await page.getByRole('button', { name: 'Guardar treino' }).click();
  const sessionHref = await page.locator('a[href^="#/sessao/"]').getAttribute('href');
  const trainingId = Number(sessionHref.split('/').pop());
  const training = await page.evaluate(async id => (await DB.listar('treinos')).find(row => Number(row.id) === id), trainingId);
  expect(training.blocos[0].exercise_snapshot).toMatchObject({
    schema: 'vision-coach-exercise-snapshot@1',
    exercise_ref: exercise.sync_id,
    nome: 'Circuito montagem E2E',
    montagem: 'Quatro cones num quadrado de 12 metros.',
    passos: ['Conduzir até ao cone.', 'Passar ao colega.', 'Mudar de posição.'],
    visual: { external_key: 'exercise-ativacao-conduzir-passar-dar-opcao' },
  });
  const approvedSource = await page.evaluate(snapshot => VisionExerciseVisuals.source(TrainingPlanner.exerciseFromSnapshot(snapshot)).src, training.blocos[0].exercise_snapshot);
  expect(approvedSource).toBe('assets/exercises/approved-20260922/01_ativacao_conduzir_passar_dar_opcao.png');

  await page.goto(`/#/consulta/${training.id}/0`);
  await expect(page.getByText('Quatro cones num quadrado de 12 metros.')).toBeVisible();
  await expect(page.getByText('Conduzir até ao cone.')).toBeVisible();
  await expect(page.getByText('Mudar de posição.')).toBeVisible();

  const report = await page.evaluate(id => ReportExporter.render('training', id), training.id);
  expect(report).toContain('Quatro cones num quadrado de 12 metros.');
  expect(report).toContain('Conduzir até ao cone.');
  expect(report).toContain('Passar ao colega.');
  expect(report).toContain('Mudar de posição.');

  await page.goto(`/#/exercicios/${exercise.id}/editar`);
  await page.getByLabel('Montagem / organização do exercício').fill('Montagem revista depois do plano.');
  await page.getByLabel('Passo a passo · um passo por linha').fill('Novo passo da biblioteca.');
  await page.getByRole('button', { name: 'Guardar exercício' }).click();
  await expect(page).toHaveURL(new RegExp(`#\\/exercicios\\/${exercise.id}$`));
  await page.goto(`/#/consulta/${training.id}/0`);
  await expect(page.getByRole('heading', { name: 'Consulta do treino' })).toBeVisible();
  await expect(page.getByText('Quatro cones num quadrado de 12 metros.')).toBeVisible();
  await expect(page.getByText('Conduzir até ao cone.')).toBeVisible();
  await expect(page.getByText('Montagem revista depois do plano.')).toHaveCount(0);

  await page.goto(`/#/treinos/${training.id}/editar`);
  await expect(page.getByRole('checkbox', { name: /Circuito montagem E2E/ })).toBeChecked();
  await page.getByRole('button', { name: 'Guardar treino' }).click();
  await expect(page).toHaveURL(new RegExp(`#\\/treinos\\/${training.id}$`));
  let savedTraining = await page.evaluate(async id => DB.obter('treinos', id), training.id);
  expect(savedTraining.blocos[0].exercise_snapshot.montagem).toBe('Quatro cones num quadrado de 12 metros.');

  await page.goto(`/#/exercicios/${exercise.id}`);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Apagar exercício' }).click();
  await expect(page).toHaveURL(/#\/exercicios$/);
  await expect.poll(() => page.evaluate(async id => !(await DB.obter('exercicios', id)), exercise.id)).toBe(true);
  await page.goto(`/#/consulta/${training.id}/0`);
  await expect(page.getByText('Quatro cones num quadrado de 12 metros.')).toBeVisible();
  await expect(page.getByText('Conduzir até ao cone.')).toBeVisible();
  await page.goto(`/#/treinos/${training.id}/editar`);
  await expect(page.getByRole('checkbox', { name: /Circuito montagem E2E.*removido da biblioteca/ })).toBeChecked();
  await expect(page.getByText(/removido da biblioteca/)).toBeVisible();
  await page.getByRole('button', { name: 'Guardar treino' }).click();
  savedTraining = await page.evaluate(async id => DB.obter('treinos', id), training.id);
  expect(savedTraining.blocos).toHaveLength(1);
  expect(savedTraining.blocos[0].exercise_snapshot.passos).toEqual(['Conduzir até ao cone.', 'Passar ao colega.', 'Mudar de posição.']);
  const historicalReport = await page.evaluate(id => ReportExporter.render('training', id), training.id);
  expect(historicalReport).toContain('Quatro cones num quadrado de 12 metros.');
  expect(historicalReport).toContain('Conduzir até ao cone.');
  expect(historicalReport).not.toContain('Montagem revista depois do plano.');
  expect(historicalReport).not.toContain('Novo passo da biblioteca.');
});
