"use strict";

const HEAD_COACH_CHAIN_NEXT = {
  observation: "diagnosis",
  hypothesis: "diagnosis",
  diagnosis: "decision",
  decision: "intervention",
  intervention: "result",
};

function cycleIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(Number)
    .filter((n) => Number.isInteger(n) && n > 0))];
}

function cycleDate(item) {
  return String(item?.occurred_at || item?.created_at || "");
}

function mapaMemoria(items) {
  return new Map((items || []).map((item) => [Number(item.id), item]));
}

function idsLigados(item) {
  return cycleIds([...(item?.related_ids || []), ...(item?.evidence_ids || [])]);
}

function cadeiaAncestral(item, byId, seen = new Set()) {
  if (!item || seen.has(Number(item.id))) return [];
  seen.add(Number(item.id));
  const parents = idsLigados(item).map((id) => byId.get(id)).filter(Boolean);
  const before = parents.flatMap((parent) => cadeiaAncestral(parent, byId, seen));
  return [...before, item];
}
function primeiroKind(chain, kind) {
  return [...chain].reverse().find((item) => item.kind === kind) || null;
}

function construirCiclosAprendizagem(items) {
  const active = (items || []).filter((item) => item.status === "active");
  const byId = mapaMemoria(items);
  const completed = active.filter((item) => item.kind === "result")
    .sort((a, b) => cycleDate(b).localeCompare(cycleDate(a)))
    .map((result) => {
      const chain = cadeiaAncestral(result, byId);
      const intervention = primeiroKind(chain, "intervention");
      const decision = primeiroKind(chain, "decision");
      const diagnosis = primeiroKind(chain, "diagnosis");
      const observation = primeiroKind(chain, "observation") || primeiroKind(chain, "fact");
      return {
        id: "result-" + result.id, status: "completed", result, intervention, decision, diagnosis, observation,
        items: chain, complete: !!(result && intervention && decision && diagnosis),
      };
    });

  const resultsByIntervention = new Set(completed.flatMap((c) =>
    c.intervention ? [Number(c.intervention.id)] : []));
  const open = active.filter((item) => item.kind === "intervention" && !resultsByIntervention.has(Number(item.id)))
    .sort((a, b) => cycleDate(b).localeCompare(cycleDate(a)))
    .map((intervention) => {
      const chain = cadeiaAncestral(intervention, byId);
      return {
        id: "intervention-" + intervention.id, status: "open", intervention,
        decision: primeiroKind(chain, "decision"), diagnosis: primeiroKind(chain, "diagnosis"),
        observation: primeiroKind(chain, "observation") || primeiroKind(chain, "fact"),
        result: null, items: chain, complete: false,
      };
    });
  return { completed, open, total: completed.length + open.length };
}
function proximoPassoMemoria(kind) {
  return HEAD_COACH_CHAIN_NEXT[kind] || null;
}

function prepararLigacaoSeguinte(seed, targetKind) {
  if (!seed) return { evidence_ids: [], related_ids: [], subject_refs: [], chain_root_id: null };
  const chainRoot = Number(seed.metadata?.chain_root_id) || Number(seed.id) || null;
  return {
    evidence_ids: targetKind === "diagnosis" ? [Number(seed.id)] : [],
    related_ids: targetKind === "diagnosis" ? [] : [Number(seed.id)],
    subject_refs: Array.isArray(seed.subject_refs) ? seed.subject_refs.map((r) => ({ ...r })) : [],
    chain_root_id: chainRoot,
  };
}

function resumoCiclo(cycle) {
  if (!cycle) return "";
  const bits = [];
  if (cycle.diagnosis) bits.push("Diagnóstico: " + (cycle.diagnosis.title || cycle.diagnosis.content));
  if (cycle.intervention) bits.push("Intervenção: " + (cycle.intervention.title || cycle.intervention.content));
  if (cycle.result) bits.push("Resultado: " + (cycle.result.title || cycle.result.content));
  return bits.join(" → ");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    HEAD_COACH_CHAIN_NEXT, construirCiclosAprendizagem, proximoPassoMemoria,
    prepararLigacaoSeguinte, resumoCiclo, cadeiaAncestral,
  };
}
