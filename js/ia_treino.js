"use strict";
// Geração de treinos de 60-75 min por IA (OpenRouter), a partir da biblioteca de exercícios do treinador.
// A chave vive em localStorage (nunca no backup exportado nem no repo). Gerar precisa de net; o treino
// gerado grava-se como um treino normal (editável) e usa-se offline.

const IA_MODELO_DEFAULT = "nvidia/nemotron-3-super-120b-a12b:free";
const IA_DURACAO_MIN = 60;
const IA_DURACAO_MAX = 75;
const IA_MAX_EXERCICIOS = 6; // máximo de exercícios por sessão (equipa e guarda-redes)

// Esqueleto pedagógico por escalão: blocos com minutos-alvo (somam entre 60 e 75) e categorias
// sugeridas. sub-7 mais lúdico; sub-10 mais jogos reduzidos/tático. Progressão da complexidade
// com a idade. No máximo 5 blocos -> no máximo 5 exercícios de equipa por treino.
const IA_ESQUELETO = {
  "sub-7": [
    { nome: "Ativação lúdica", min: 15, categorias: ["Jogos lúdicos", "Coordenação / motricidade"] },
    { nome: "Fundamento técnico", min: 15, categorias: ["Domínio e condução de bola", "Passe e receção"] },
    { nome: "Jogos reduzidos", min: 20, categorias: ["Jogos reduzidos (SSG)"] },
    { nome: "Jogo final", min: 10, categorias: ["Jogo final"] },
    { nome: "Retorno à calma", min: 5, categorias: ["Jogos lúdicos"] },
  ],
  "sub-8": [
    { nome: "Ativação lúdica", min: 12, categorias: ["Jogos lúdicos", "Coordenação / motricidade"] },
    { nome: "Fundamento técnico", min: 16, categorias: ["Domínio e condução de bola", "Passe e receção", "Remate / finalização"] },
    { nome: "Jogos reduzidos", min: 20, categorias: ["Jogos reduzidos (SSG)"] },
    { nome: "Jogo final", min: 15, categorias: ["Jogo final"] },
    { nome: "Retorno à calma", min: 5, categorias: ["Jogos lúdicos"] },
  ],
  "sub-9": [
    { nome: "Ativação", min: 10, categorias: ["Coordenação / motricidade", "Jogos lúdicos"] },
    { nome: "Fundamento técnico", min: 17, categorias: ["Domínio e condução de bola", "Passe e receção", "Remate / finalização"] },
    { nome: "Jogos reduzidos", min: 23, categorias: ["Jogos reduzidos (SSG)"] },
    { nome: "Jogo final", min: 15, categorias: ["Jogo final"] },
    { nome: "Retorno à calma", min: 5, categorias: ["Jogos lúdicos"] },
  ],
  "sub-10": [
    { nome: "Ativação", min: 10, categorias: ["Coordenação / motricidade"] },
    { nome: "Fundamento técnico", min: 15, categorias: ["Passe e receção", "Remate / finalização", "Domínio e condução de bola"] },
    { nome: "Jogos reduzidos", min: 25, categorias: ["Jogos reduzidos (SSG)"] },
    { nome: "Jogo final", min: 17, categorias: ["Jogo final"] },
    { nome: "Retorno à calma", min: 5, categorias: ["Jogos lúdicos"] },
  ],
};

// ---- configuração (localStorage: fora do backup) ----
function iaConfig() {
  return {
    key: localStorage.getItem("ia_openrouter_key") || "",
    modelo: localStorage.getItem("ia_modelo") || IA_MODELO_DEFAULT,
  };
}
function iaGuardarConfig(key, modelo) {
  if (key != null) localStorage.setItem("ia_openrouter_key", key.trim());
  localStorage.setItem("ia_modelo", (modelo && modelo.trim()) || IA_MODELO_DEFAULT);
}

// Testa a chave guardada contra o OpenRouter (endpoint /key: não gasta créditos).
async function iaTestarChave() {
  const { key } = iaConfig();
  if (!key) return "Não há chave guardada. Cola uma e carrega em Guardar primeiro.";
  const resp = await fetch("https://openrouter.ai/api/v1/key", { headers: { "Authorization": `Bearer ${key}` } });
  if (resp.status === 401 || resp.status === 403)
    return `❌ Chave inválida ou revogada (termina em …${key.slice(-4)}).\n\nGera uma nova em openrouter.ai/keys e cola aqui.`;
  if (!resp.ok) return `❌ OpenRouter ${resp.status}. Tenta outra vez.`;
  const d = (await resp.json())?.data || {};
  return `✅ Chave válida (termina em …${key.slice(-4)}).\nUsado: ${d.usage ?? "?"}\nLimite: ${d.limit ?? "sem limite"}`;
}

// ---- funções puras (testáveis em Node) ----
function iaSomaEsqueleto(escalao) {
  return (IA_ESQUELETO[escalao] || []).reduce((s, b) => s + b.min, 0);
}

// Atribui a duração de cada exercício de equipa a partir do esqueleto de blocos, em vez de
// confiar no valor que a IA propõe (o modelo é pouco fiável a fazer a conta somar certo).
// No máximo 1 exercício por bloco (corta o excesso); se a IA devolver menos exercícios que
// blocos, redistribui os minutos em falta pelos que existem para o total continuar a bater
// certo com o esqueleto (aquecimento continua mais curto, blocos de jogo mais compridos).
function iaAtribuirDuracoes(itens, blocos) {
  const n = Math.min(itens.length, blocos.length);
  itens.length = n; // nunca mais exercícios de equipa que blocos do esqueleto
  if (n === 0) return itens;
  const alvoTotal = blocos.reduce((s, b) => s + b.min, 0);
  const pesos = blocos.slice(0, n).map((b) => b.min);
  const somaPesos = pesos.reduce((s, w) => s + w, 0);
  let atribuido = 0;
  itens.forEach((it, i) => {
    const dur = i === n - 1
      ? alvoTotal - atribuido // o último absorve o resto: soma dá sempre exatamente o alvo
      : Math.max(5, Math.round((pesos[i] / somaPesos) * alvoTotal));
    it.duracao_min = dur;
    atribuido += dur;
  });
  return itens;
}

// Treino individual de guarda-redes por defeito, usado quando a IA não devolve "itens_gr"
// (acontece com modelos free menos obedientes) — garante que o GR nunca fica sem plano.
function iaFallbackGR(exerciciosGR, max = IA_MAX_EXERCICIOS) {
  return exerciciosGR.slice(0, max).map((ex, i) => ({
    exercicio_id: Number(ex.id),
    ordem: i,
    duracao_min: ex.duracao_min || 10,
    bloco: null,
    nota: null,
    com_gr: false,
  }));
}

// Extrai o objeto JSON da resposta do modelo (tolera cercas ```json e texto à volta).
function iaExtrairJSON(txt) {
  if (!txt) throw new Error("resposta vazia da IA");
  let s = String(txt).trim();
  const cerca = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (cerca) s = cerca[1].trim();
  else { const i = s.indexOf("{"), j = s.lastIndexOf("}"); if (i !== -1 && j > i) s = s.slice(i, j + 1); }
  return JSON.parse(s);
}

// Valida os itens devolvidos pela IA contra os exercícios reais: só ids existentes,
// duração limitada a 1..45, ordem sequencial, no máximo maxItens. Descarta o que a IA inventar.
function iaValidarItens(itensIA, exercicios, maxItens = IA_MAX_EXERCICIOS) {
  const porId = new Map(exercicios.map((e) => [Number(e.id), e]));
  const out = [];
  let ordem = 0;
  for (const it of (itensIA || [])) {
    if (out.length >= maxItens) break; // nunca ultrapassa o máximo de exercícios por sessão
    const ex = porId.get(Number(it.exercicio_id));
    if (!ex) continue; // exercício inexistente -> ignora (nunca inventa material)
    let dur = Number(it.duracao_min);
    if (!Number.isFinite(dur) || dur <= 0) dur = ex.duracao_min || 10;
    dur = Math.max(1, Math.min(45, Math.round(dur)));
    out.push({
      exercicio_id: Number(ex.id),
      ordem: ordem++,
      duracao_min: dur,
      bloco: (it.bloco || "").toString().slice(0, 60) || null,
      nota: (it.nota || "").toString().slice(0, 300) || null,
      com_gr: !!it.com_gr, // exercício de equipa que envolve o guarda-redes
    });
  }
  return out;
}

// ---- prompt ----
function iaConstruirPrompt(escalao, foco, exercicios, nJogadores, exerciciosGR, dificuldades, exerciciosRecentes) {
  const dif = dificuldades && dificuldades.tags && dificuldades.tags.length
    ? `\n\nDIFICULDADES RECENTES a trabalhar (dá-lhes prioridade e distribui-as pelos blocos certos): ${dificuldades.tags.join(", ")}${(dificuldades.notas && dificuldades.notas.length) ? ` (notas do treinador: ${dificuldades.notas.join("; ")})` : ""}.`
    : "";
  const rep = (exerciciosRecentes && exerciciosRecentes.length)
    ? `\n\nJá saíram nos últimos treinos — EVITA repetir a maioria, no máximo mantém 1 para consolidar; procura variar: ${exerciciosRecentes.join(", ")}.`
    : "";
  const blocos = IA_ESQUELETO[escalao] || [];
  const duracaoAlvo = blocos.reduce((s, b) => s + b.min, 0);
  const lista = exercicios.map((e) =>
    `#${e.id} | ${e.titulo} | ${e.categoria || "sem categoria"} | ${e.duracao_min || "?"}min | ${e.n_jogadores_min || "?"}-${e.n_jogadores_max || "?"} jog.`
  ).join("\n");
  const estrutura = blocos.map((b) => `- ${b.nome} (~${b.min} min) — categorias ideais: ${b.categorias.join(", ")}`).join("\n");
  const listaGR = (exerciciosGR && exerciciosGR.length)
    ? exerciciosGR.map((e) => `#${e.id} | ${e.titulo} | ${e.duracao_min || "?"}min`).join("\n") : "";
  const blocoGR = listaGR
    ? `\n\nHÁ SEMPRE GUARDA-REDES nesta sessão. Duas coisas:
1) Em cada exercício de EQUIPA, marca "com_gr": true se o exercício ENVOLVE o guarda-redes (tem baliza, finalização ou jogo), ou false se não precisa de GR (coordenação, passe sem baliza, condução).
2) Monta À PARTE um TREINO INDIVIDUAL do guarda-redes em "itens_gr": no MÁXIMO 5 a 6 exercícios de GR numa progressão coerente (aquecimento de mãos e posição → pega e defesa → deslocamentos e bola alta → jogo com os pés), para os momentos em que a equipa NÃO precisa dele. Usa APENAS exercícios de GR desta lista (pelo #id), não inventes:
${listaGR}`
    : "";
  const restricaoJog = nJogadores > 0
    ? `\n\nSÓ TENS ${nJogadores} JOGADOR(ES). A lista de exercícios abaixo JÁ ESTÁ FILTRADA para exercícios reais que funcionam com ${nJogadores}. Regras rígidas:
- Usa APENAS exercícios da lista (pelo #id). Nunca inventes exercícios nem formatos.
- NUNCA sugiras substituir jogadores por cones, bonecos, manequins ou "imaginários".
- NÃO proponhas jogos que precisem de mais de ${nJogadores} jogadores (ex.: nada de 3v3 se só tens ${nJogadores}).
- Escolhe o exercício REAL mais adequado da lista para cada bloco; se um bloco não tiver opção ideal, usa o mais próximo que funcione mesmo com ${nJogadores}.`
    : "";
  const system =
`És um treinador experiente de futebol de formação em Portugal (metodologia FPF). Planeias sessões de treino que fazem EVOLUIR as crianças: do lúdico e da técnica individual nos mais novos, para os jogos reduzidos e o jogo com intenção tática nos mais velhos. Adaptas sempre à idade: sub-7/8 mais lúdico e técnico, sub-9/10 mais jogos reduzidos e tomada de decisão. Adaptas SEMPRE ao número real de jogadores disponíveis.
Respondes SEMPRE e APENAS com um objeto JSON válido, sem texto à volta, sem cercas de código.`;
  const user =
`Monta um treino entre ${IA_DURACAO_MIN} e ${IA_DURACAO_MAX} minutos (alvo: ~${duracaoAlvo} min) para o escalão ${escalao}${foco ? `, com FOCO em: ${foco}` : ""}.${dif}${rep}${restricaoJog}${blocoGR}

Estrutura pedagógica (blocos e minutos-alvo, deve somar entre ${IA_DURACAO_MIN} e ${IA_DURACAO_MAX}, idealmente ~${duracaoAlvo}):
${estrutura}

Escolhe exercícios de equipa EXCLUSIVAMENTE desta biblioteca (usa o número #id). NÃO inventes exercícios nem uses ids fora da lista. Para cada bloco escolhe 1 exercício adequado à idade, ao foco e ao número de jogadores — no MÁXIMO ${IA_MAX_EXERCICIOS} exercícios de equipa no total; ajusta a duração de cada um para o total ficar entre ${IA_DURACAO_MIN} e ${IA_DURACAO_MAX} min.

Biblioteca disponível (#id | título | categoria | duração-base | jogadores):
${lista}

Devolve JSON exatamente com este formato:
{
  "resumo": "1-2 frases: o conceito pedagógico do treino e como faz evoluir estas crianças",
  "itens": [
    { "exercicio_id": <id da lista>, "bloco": "<nome do bloco>", "duracao_min": <inteiro>, "nota": "porque este exercício aqui"${listaGR ? `, "com_gr": <true se envolve o guarda-redes, senão false>` : ""} }
  ]${listaGR ? `,
  "itens_gr": [
    { "exercicio_id": <id da lista de GR>, "bloco": "<fase do GR>", "duracao_min": <inteiro>, "nota": "detalhe" }
  ]` : ""}
}`;
  return { system, user };
}

// ---- chamada OpenRouter (com retry no 429: modelos free saturam a segundos) ----
async function iaChamarOpenRouter(key, modelo, system, user) {
  const body = JSON.stringify({
    model: modelo,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: 0.8, // um pouco mais de variedade entre treinos
  });
  const MAX = 4; // ponytail: 4 tentativas com espera crescente resolve o 429 transitório dos free
  let ultimoErro = "";
  for (let t = 1; t <= MAX; t++) {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body,
    });
    if (resp.ok) {
      const data = await resp.json();
      const txt = data?.choices?.[0]?.message?.content;
      if (!txt) throw new Error("resposta da IA sem conteúdo");
      return txt;
    }
    let det = ""; try { det = (await resp.json())?.error?.message || ""; } catch (_) {}
    ultimoErro = `OpenRouter ${resp.status}${det ? ": " + det : ""}`;
    if (resp.status === 401 || resp.status === 403)
      throw new Error(ultimoErro + " — a chave já não é aceite. Gera uma nova em openrouter.ai/keys e cola em Dados → IA.");
    if (resp.status === 402)
      throw new Error(ultimoErro + " — sem créditos/limite diário esgotado no OpenRouter.");
    if (resp.status === 429 && t < MAX) {
      await new Promise((r) => setTimeout(r, t * 3000)); // 3s, 6s, 9s
      continue;
    }
    break; // erro não-429, ou esgotou as tentativas
  }
  throw new Error(ultimoErro + (ultimoErro.startsWith("OpenRouter 429") ? " (modelo free ocupado; tenta outra vez ou muda de modelo)" : ""));
}

// ---- orquestração: gera e grava o treino, devolve o id ----
async function gerarTreinoIA(escalao, foco, nJogadores, data, hora) {
  if (!IA_ESQUELETO[escalao]) throw new Error("escalão inválido");
  const { key, modelo } = iaConfig();
  if (!key) throw new Error("Falta a chave OpenRouter (Dados → IA).");
  if (typeof navigator !== "undefined" && navigator.onLine === false)
    throw new Error("Sem internet. Gera o treino com net; depois usa-o offline.");

  const todos = await DB.listar("exercicios");
  const noEscalao = todos.filter((e) => (e.escaloes || []).includes(escalao));
  const doEscalao = noEscalao.filter((e) => e.categoria !== "Guarda-redes"); // pool de equipa (GR à parte)
  const exerciciosGR = noEscalao.filter((e) => e.categoria === "Guarda-redes"); // GR sempre incluído
  if (doEscalao.length < 3)
    throw new Error(`Poucos exercícios para ${escalao}. Carrega a biblioteca-base (Dados → biblioteca).`);

  // nº de jogadores: usa o indicado; se vazio, conta o plantel do escalão
  let n = Number(nJogadores);
  if (!Number.isFinite(n) || n <= 0) {
    const jogs = await DB.listar("jogadores");
    n = jogs.filter((j) => escalaoDeJogador(j) === escalao).length;
  }

  // filtra ao nº de jogadores: a IA só vê exercícios que funcionam mesmo com n.
  // se sobrar muito pouco, manda tudo (senão o treino ficava vazio) — mas com a biblioteca
  // de poucos-jogadores isto raramente acontece.
  const cabem = n > 0 ? doEscalao.filter((e) => (e.n_jogadores_min || 1) <= n) : doEscalao;
  const listaAI = cabem.length >= 5 ? cabem : doEscalao;

  // evolução: dificuldades recentes (foco pré-cheio se vazio) + exercícios dos últimos treinos (anti-repetição)
  const todosTreinos = await DB.listar("treinos");
  const dificuldades = dificuldadesRecentes(todosTreinos, await DB.listar("jogos"), escalao);
  if (!foco) foco = focoDoUltimoTreino(todosTreinos, escalao) || null; // foco sugerido = dificuldade do último treino
  const treinosEsc = todosTreinos.filter((t) => t.escalao === escalao)
    .sort((a, b) => (a.data < b.data ? 1 : -1)).slice(0, 4);
  const idsRecentes = new Set();
  for (const t of treinosEsc)
    for (const it of await DB.porIndice("treino_itens", "treino_id", t.id)) idsRecentes.add(it.exercicio_id);
  const exerciciosRecentes = [...idsRecentes].map((eid) => (todos.find((e) => e.id === eid) || {}).titulo).filter(Boolean);

  const { system, user } = iaConstruirPrompt(escalao, foco, listaAI, n, exerciciosGR, dificuldades, exerciciosRecentes);
  const txt = await iaChamarOpenRouter(key, modelo, system, user);
  const parsed = iaExtrairJSON(txt);
  const itens = iaValidarItens(parsed.itens, doEscalao);
  if (!itens.length) throw new Error("A IA não devolveu exercícios válidos. Tenta outra vez.");
  iaAtribuirDuracoes(itens, IA_ESQUELETO[escalao]); // duração de cada exercício = minutos-alvo do bloco, não o valor (pouco fiável) da IA
  let itensGR = exerciciosGR.length ? iaValidarItens(parsed.itens_gr, exerciciosGR) : [];
  if (!itensGR.length && exerciciosGR.length) itensGR = iaFallbackGR(exerciciosGR); // a IA às vezes não devolve "itens_gr"

  const notas = parsed.resumo ? parsed.resumo.toString().trim() : null; // só o resumo pedagógico (sem marca de IA)
  const treinoId = await DB.criar("treinos", { data: data || new Date().toISOString().slice(0, 10), hora: hora || null, escalao, notas });
  for (const it of itens) await DB.criar("treino_itens", { treino_id: treinoId, parte: "equipa", ...it });
  for (const it of itensGR) await DB.criar("treino_itens", { treino_id: treinoId, parte: "gr", ...it });
  return treinoId;
}

// ---- self-check (corre só em Node, não no browser) ----
if (typeof window === "undefined" && typeof process !== "undefined") {
  const assert = (c, m) => { if (!c) { console.error("FALHOU:", m); process.exit(1); } };
  for (const e of ["sub-7", "sub-8", "sub-9", "sub-10"]) {
    const soma = iaSomaEsqueleto(e);
    assert(soma >= IA_DURACAO_MIN && soma <= IA_DURACAO_MAX, `esqueleto ${e} devia somar entre ${IA_DURACAO_MIN} e ${IA_DURACAO_MAX}, deu ${soma}`);
    assert((IA_ESQUELETO[e] || []).length <= IA_MAX_EXERCICIOS, `esqueleto ${e} tem mais blocos que o máximo de exercícios (${IA_MAX_EXERCICIOS})`);
  }

  const j1 = iaExtrairJSON('```json\n{"a":1}\n```'); assert(j1.a === 1, "extrair com cerca json");
  const j2 = iaExtrairJSON('lixo antes {"b":2} lixo depois'); assert(j2.b === 2, "extrair com texto à volta");

  const exs = [{ id: 5, titulo: "X", duracao_min: 10 }, { id: 8, titulo: "Y", duracao_min: 12 }];
  const v = iaValidarItens([
    { exercicio_id: 5, duracao_min: 15, bloco: "A", nota: "n" },
    { exercicio_id: 999, duracao_min: 10 },              // inexistente -> descartado
    { exercicio_id: 8, duracao_min: 200 },                // duração clampada a 45
    { exercicio_id: 8, duracao_min: 0 },                  // 0 -> usa base do exercício (12)
  ], exs);
  assert(v.length === 3, `devia manter 3 itens válidos, deu ${v.length}`);
  assert(v[0].ordem === 0 && v[2].ordem === 2, "ordem sequencial");
  assert(v[1].duracao_min === 45, "duração clampada a 45");
  assert(v[2].duracao_min === 12, "duração 0 recua à base do exercício");

  const exsMuitos = Array.from({ length: 10 }, (_, i) => ({ id: i, titulo: `E${i}`, duracao_min: 10 }));
  const vCap = iaValidarItens(exsMuitos.map((e) => ({ exercicio_id: e.id, duracao_min: 10 })), exsMuitos);
  assert(vCap.length === IA_MAX_EXERCICIOS, `devia cortar no máximo de ${IA_MAX_EXERCICIOS} exercícios, deu ${vCap.length}`);

  // iaAtribuirDuracoes: ignora a duração que a IA propôs (aqui sempre 10, errado de propósito)
  // e usa os minutos do esqueleto -> soma tem de bater certo com o alvo do escalão.
  for (const esc of ["sub-7", "sub-8", "sub-9", "sub-10"]) {
    const blocos = IA_ESQUELETO[esc];
    const alvo = iaSomaEsqueleto(esc);
    const itensCompletos = blocos.map((_, i) => ({ exercicio_id: i, duracao_min: 10 }));
    const r1 = iaAtribuirDuracoes(itensCompletos.map((it) => ({ ...it })), blocos);
    assert(r1.length === blocos.length, `iaAtribuirDuracoes(${esc}): devia manter ${blocos.length} itens, deu ${r1.length}`);
    assert(r1.reduce((s, it) => s + it.duracao_min, 0) === alvo, `iaAtribuirDuracoes(${esc}): soma devia ser ${alvo}`);
    assert(r1[0].duracao_min < r1[2].duracao_min, `iaAtribuirDuracoes(${esc}): aquecimento devia ficar mais curto que o bloco de jogo`);

    const itensAMais = blocos.map((_, i) => ({ exercicio_id: i, duracao_min: 10 })).concat([{ exercicio_id: 99, duracao_min: 10 }]);
    const r2 = iaAtribuirDuracoes(itensAMais, blocos);
    assert(r2.length === blocos.length, `iaAtribuirDuracoes(${esc}) com excesso: devia cortar para ${blocos.length}, deu ${r2.length}`);

    const itensAMenos = [{ exercicio_id: 0, duracao_min: 10 }, { exercicio_id: 1, duracao_min: 10 }];
    const r3 = iaAtribuirDuracoes(itensAMenos, blocos);
    assert(r3.reduce((s, it) => s + it.duracao_min, 0) === alvo, `iaAtribuirDuracoes(${esc}) com défice: soma devia continuar ${alvo}`);
  }

  // iaFallbackGR: garante plano de GR mesmo que a IA não devolva "itens_gr"
  const exsGR = Array.from({ length: 8 }, (_, i) => ({ id: 100 + i, titulo: `GR${i}`, duracao_min: 8 + i }));
  const fbGR = iaFallbackGR(exsGR);
  assert(fbGR.length === IA_MAX_EXERCICIOS, `iaFallbackGR devia dar ${IA_MAX_EXERCICIOS} itens, deu ${fbGR.length}`);
  assert(fbGR[0].exercicio_id === 100 && fbGR[0].duracao_min === 8, "iaFallbackGR usa a duração base do exercício");

  console.log(`ok ia_treino: esqueletos=${IA_DURACAO_MIN}-${IA_DURACAO_MAX}min, max=${IA_MAX_EXERCICIOS} exercícios, duração por bloco, fallback GR, extrair JSON, validar itens`);
}
