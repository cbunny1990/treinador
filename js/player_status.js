"use strict";

const PLAYER_AVAILABILITY = Object.freeze({
  disponivel: "Disponível",
  indisponivel: "Indisponível",
  lesionado: "Lesionado",
  castigado: "Castigado",
  ausente: "Ausente",
});

function normalizePlayerAvailability(value) {
  const key = String(value || "disponivel").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PLAYER_AVAILABILITY, key) ? key : "disponivel";
}

function playerAvailabilityLabel(value) {
  return PLAYER_AVAILABILITY[normalizePlayerAvailability(value)];
}

function playerInRoster(player) {
  return player?.plantel_ativo !== false;
}

function playerIsAvailable(player) {
  return playerInRoster(player) && normalizePlayerAvailability(player?.estado_disponibilidade) === "disponivel";
}

function playerStatusClass(value) {
  const status = normalizePlayerAvailability(value);
  return status === "disponivel" ? "ready" : "system";
}

const PlayerStatus = {
  statuses: PLAYER_AVAILABILITY,
  normalize: normalizePlayerAvailability,
  label: playerAvailabilityLabel,
  inRoster: playerInRoster,
  isAvailable: playerIsAvailable,
  badgeClass: playerStatusClass,
};

if (typeof globalThis !== "undefined") globalThis.PlayerStatus = PlayerStatus;
if (typeof module !== "undefined" && module.exports) module.exports = PlayerStatus;
