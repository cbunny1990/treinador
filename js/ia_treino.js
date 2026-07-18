"use strict";
// Geração de treinos de 90 min por IA (OpenRouter), a partir da biblioteca de exercícios do treinador.
// A chave vive em localStorage (nunca no backup exportado nem no repo). Gerar precisa de net; o treino
// gerado grava-se como um treino normal (editável) e usa-se offline.

const IA_MODELO_DEFAULT = "nvidia/nemotron-3-super-120b-a12b:free";
const IA_DURACAO_TOTAL = 90;

// Esqueleto pedagógico por escalão: blocos com minutos-alvo (somam 90) e categorias sugeridas.
// sub-7 mais lúdico; sub-10 mais jogos reduzidos/tático. Progressão da complexidade com a idade.
const IA_ESQUELETO = {
  "sub-7": [
    { nome: "Ativação lúdica", min: 20, categorias: ["Jogos lúdicos", "Coordenação / motricidade"] },
    { nome: "Fundamento técnico", min: 20, categorias: ["Domínio e condução de bola", "Passe e receção"] },
    { nome: "Jogos reduzidos", min: 25, categorias: ["Jogos reduzidos (SSG)"] },
    { nome: "Jogo final", min: 20, categorias: ["Jogo final"] },
    { nome: "Retorno à calma", min: 5, categorias: ["Jogos lúdicos"] },
  ],
  "sub-8": [
    { nome: "Ativação lúdica", min: 15, categorias: ["Jogos lúdicos", "Coordenação / motricidade"] },
    { nome: "Fundamento técnico", min: 22, categorias: ["Domínio e condução de bola", "Passe e receção", "Remate / finalização"] },
    { nome: "Jogos reduzidos", min: 28, categorias: ["Jogos reduzidos (SSG)"] },
    { nome: "Jogo final", min: 20, categorias: ["Jogo final"] },
    { nome: "Retorno à calma", min: 5, categorias: ["Jogos lúdicos"] },
  ],
  "sub-9": [
    { nome: "Ativação", min: 12, categorias: ["Coordenação / motricidade", "Jogos lúdicos"] },
    { nome: "Fundamento técnico", min: 23, categorias: ["Domínio e condução de bola", "Passe e receção", "Remate / finalização"] },
    { nome: "Jogos reduzidos", min: 30, categorias: ["Jogos reduzidos (SSG)"] },
    { nome: "Jogo final", min: 20, categorias: ["Jogo final"] },
    { nome: "Retorno à calma", min: 5, categorias: ["Jogos lúdicos"] },
  ],
  "sub-10": [
    { nome: "Ativação", min: 12, categorias: ["Coordenação / motricidade"] },
    { nome: "Fundamento técnico", min: 21, categorias: ["Passe e receção", "Remate / finalização", "Domínio e condução de bola"] },
    { nome: "Jogos reduzidos", min: 32, categorias: ["Jogos reduzidos (SSG)"] },
    { nome: "Jogo final", min: 20, categorias: ["Jogo final"] },
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

// ---- funções puras (testáveis em Node) ----
function iaSomaEsqueleto(escalao) {
  return (IA_ESQUELETO[escalao] || []).reduce((s, b) => s + b.min, 0);
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
// duração limitada a 1..45, ordem sequencial. Descarta o que a IA inventar.
function iaValidarItens(itensIA, exercicios) {
  const porId = new Map(exercicios.map((e) => [Number(e.id), e]));
  const out = [];
  let ordem = 0;
  for (const it of (itensIA || [])) {
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
  const lista = exercicios.map((e) =>
    `#${e.id} | ${e.titulo} | ${e.categoria || "sem categoria"} | ${e.duracao_min || "?"}min | ${e.n_jogadores_min || "?"}-${e.n_jogadores_max || "?"} jog.`
  ).join("\n");
  const estrutura = blocos.map((b) => `- ${b.nome} (~${b.min} min) — categorias ideais: ${b.categorias.join(", ")}`).join("\n");
  const listaGR = (exerciciosGR && exerciciosGR.length)
    ? exerciciosGR.map((e) => `#${e.id} | ${e.titulo} | ${e.duracao_min || "?"}min`).join("\n") : "";
  const blocoGR = listaGR
    ? `\n\nHÁ SEMPRE GUARDA-REDES nesta sessão. Duas coisas:
1) Em cada exercício de EQUIPA, marca "com_gr": true se o exercício ENVOLVE o guarda-redes (tem baliza, finalização ou jogo), ou false se não precisa de GR (coordenação, passe sem baliza, condução).
2) Monta À PARTE um TREINO INDIVIDUAL do guarda-redes em "itens_gr": 4 a 6 exercícios de GR numa progressão coerente (aquecimento de mãos e posição → pega e defesa → deslocamentos e bola alta → jogo com os pés), para os momentos em que a equipa NÃO precisa dele. Usa APENAS exercícios de GR desta lista (pelo #id), não inventes:
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
`Monta um treino de ${IA_DURACAO_TOTAL} minutos para o escalão ${escalao}${foco ? `, com FOCO em: ${foco}` : ""}.${dif}${rep}${restricaoJog}${blocoGR}

Estrutura pedagógica (blocos e minutos-alvo, deve somar ~${IA_DURACAO_TOTAL}):
${estrutura}

Escolhe exercícios de equipa EXCLUSIVAMENTE desta biblioteca (usa o número #id). NÃO inventes exercícios nem uses ids fora da lista. Para cada bloco escolhe 1 exercício adequado à idade, ao foco e ao número de jogadores; ajusta a duração para o total dar ~${IA_DURACAO_TOTAL} min.

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
  if (!foco) foco = dificuldades.top || null;
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
  const itensGR = exerciciosGR.length ? iaValidarItens(parsed.itens_gr, exerciciosGR) : [];

  const notas = parsed.resumo ? parsed.resumo.toString().trim() : null; // só o resumo pedagógico (sem marca de IA)
  const treinoId = await DB.criar("treinos", { data: data || new Date().toISOString().slice(0, 10), hora: hora || null, escalao, notas });
  for (const it of itens) await DB.criar("treino_itens", { treino_id: treinoId, parte: "equipa", ...it });
  for (const it of itensGR) await DB.criar("treino_itens", { treino_id: treinoId, parte: "gr", ...it });
  return treinoId;
}

// ---- self-check (corre só em Node, não no browser) ----
if (typeof window === "undefined" && typeof process !== "undefined") {
  const assert = (c, m) => { if (!c) { console.error("FALHOU:", m); process.exit(1); } };
  for (const e of ["sub-7", "sub-8", "sub-9", "sub-10"])
    assert(iaSomaEsqueleto(e) === 90, `esqueleto ${e} devia somar 90, deu ${iaSomaEsqueleto(e)}`);

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
  console.log("ok ia_treino: esqueletos=90, extrair JSON, validar itens");
}
