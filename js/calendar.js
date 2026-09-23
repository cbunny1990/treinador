"use strict";

const VISION_CALENDAR_WEEKS = 6;

function vcIsoDate(value) {
  const iso = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : "";
}

function vcAddDays(iso, days) {
  const date = new Date(vcIsoDate(iso) + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function vcWeekday(iso) {
  return new Date(vcIsoDate(iso) + "T12:00:00Z").getUTCDay();
}

function vcArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeVisionMatch(match) {
  const row = { ...(match || {}) };
  row.estado = row.estado || "agendado";
  row.pre_game = { status: "draft", objetivo_principal: null, plano_jogo: null, adversario_notas: null, pontos_observar: [], ...(row.pre_game || {}) };
  row.callup = { status: "draft", player_ids: [], notes: null, ...(row.callup || {}) };
  row.lineup = { status: "draft", system: "1-2-1", goalkeeper_id: null, starters: [], substitutes: [], ...(row.lineup || {}) };
  row.during = { events: [], notes: [], halftime_score: null, ...(row.during || {}) };
  row.post_game = { status: "pending", correu_bem: null, melhorar: null, conclusoes: null, acoes_proximo_treino: [], ...(row.post_game || {}) };
  row.pre_game.pontos_observar = vcArray(row.pre_game.pontos_observar);
  row.callup.player_ids = vcArray(row.callup.player_ids);
  row.lineup.starters = vcArray(row.lineup.starters);
  row.lineup.substitutes = vcArray(row.lineup.substitutes);
  row.during.events = vcArray(row.during.events);
  row.during.notes = vcArray(row.during.notes);
  row.post_game.acoes_proximo_treino = vcArray(row.post_game.acoes_proximo_treino);
  return row;
}

function visionPlannedTrainings(team, from, weeks) {
  const start = vcIsoDate(from);
  const rules = vcArray(team?.horarios?.estruturado?.treinos);
  if (!start || !rules.length) return [];
  const horizon = Math.max(1, Number(weeks || VISION_CALENDAR_WEEKS)) * 7;
  const events = [];
  for (let offset = 0; offset < horizon; offset++) {
    const date = vcAddDays(start, offset);
    const weekday = vcWeekday(date);
    for (const rule of rules) {
      if (Number(rule.dia_semana) !== weekday) continue;
      events.push({
        type: "training_schedule",
        planned: true,
        date,
        time: rule.inicio || null,
        end_time: rule.fim || null,
        title: "Treino previsto",
      });
    }
  }
  return events;
}

function visionCalendarEvents(snapshot, options) {
  const cfg = options || {};
  const from = vcIsoDate(cfg.from || new Date().toISOString().slice(0, 10));
  const weeks = Number(cfg.weeks || VISION_CALENDAR_WEEKS);
  const seenMatches = new Set();
  const matches = vcArray(snapshot?.matches).filter((m) => {
    // Deduplicate repeated copies of the same persisted match only. Date,
    // time and opponent are not an identity: two fixtures can share them.
    const stableId = m?.sync_id || m?.external_key || (m?.id != null ? "local:" + m.id : "");
    if (!stableId) return true;
    const key = String(stableId);
    if (seenMatches.has(key)) return false;
    seenMatches.add(key);
    return true;
  }).map((m) => ({
    type: "match", planned: false, date: vcIsoDate(m.data), time: m.hora || null,
    title: "Jogo vs " + (m.adversario || "Adversário"), id: m.id, item: normalizeVisionMatch(m),
  }));
  const trainings = vcArray(snapshot?.trainings).map((t) => ({
    type: "training", planned: false, date: vcIsoDate(t.data), time: t.hora || null,
    end_time: t.hora_fim || null, title: "Treino " + (t.escalao || ""), id: t.id, item: t,
  }));
  const slotKey = (event) => [event.date, event.time || ""].join("|");
  const actualTrainingSlots = new Set(trainings.map(slotKey));
  const plannedSlots = new Set();
  const planned = visionPlannedTrainings(snapshot?.team, from, weeks)
    .filter((event) => {
      const key = slotKey(event);
      if (actualTrainingSlots.has(key) || plannedSlots.has(key)) return false;
      plannedSlots.add(key);
      return true;
    });
  const until = from ? vcAddDays(from, Math.max(1, weeks) * 7) : "";
  return matches.concat(trainings, planned)
    .filter((x) => x.date && (!from || (x.date >= from && x.date < until)))
    .sort((a, b) => (a.date + "T" + (a.time || "99:99")).localeCompare(b.date + "T" + (b.time || "99:99")));
}

function visionMatchProgress(match) {
  const m = normalizeVisionMatch(match);
  return {
    pre_game: Boolean(m.pre_game.objetivo_principal || m.pre_game.plano_jogo || m.pre_game.pontos_observar.length),
    callup: m.callup.player_ids.length > 0,
    lineup: Boolean(m.lineup.goalkeeper_id || m.lineup.starters.length),
    post_game: m.post_game.status === "done" || Boolean(m.post_game.conclusoes || m.post_game.correu_bem || m.post_game.melhorar),
  };
}

const VisionCalendar = {
  normalizeMatch: normalizeVisionMatch,
  plannedTrainings: visionPlannedTrainings,
  events: visionCalendarEvents,
  matchProgress: visionMatchProgress,
};

if (typeof globalThis !== "undefined") globalThis.VisionCalendar = VisionCalendar;
if (typeof module !== "undefined" && module.exports) module.exports = VisionCalendar;
