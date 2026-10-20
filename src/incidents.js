import { dbEnabled } from "./db/postgres.js";
import { insertIncident } from "./db/repository.js";
import { enqueuePersist } from "./db/persistQueue.js";

/** @type {object[]} */
const incidents = [];

export function recordIncident(incident) {
  const row = {
    id: incident.id || `inc-${Date.now()}-${incidents.length + 1}`,
    at: incident.at || new Date().toISOString(),
    ...incident,
  };
  incidents.unshift(row);
  if (dbEnabled()) {
    enqueuePersist("incident", () => insertIncident(row));
  }
  return row;
}

export function listIncidents() {
  return [...incidents];
}

export function getIncident(id) {
  return incidents.find((i) => i.id === id) ?? null;
}

export function resetIncidents() {
  incidents.length = 0;
}

export function hydrateIncidents(rows = []) {
  resetIncidents();
  for (const row of rows) incidents.push(row);
}
