const { test, expect } = require('@playwright/test');

test('biblioteca guarda montagem e passos para consulta e plano exportado', async ({ page }) => {
  await page.goto('/#/exercicios/novo');
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
  await expect(page.getByText('Circuito montagem E2E')).toBeVisible();
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
