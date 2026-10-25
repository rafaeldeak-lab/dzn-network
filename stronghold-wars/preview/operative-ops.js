// Local-only tactical expedition rules. Live DZN play requires a reviewed,
// authoritative operation service; browser storage is never a trust boundary.
import { SQUAD_ROLES, squadUnlocked } from './squad-assets.js';

export const OPERATIVES = Object.freeze({
  rivet: Object.freeze({ name: 'Rivet', title: 'Breach Engineer', role: 'engineer', colour: '#efad58', passive: 'Prepared Entry', tactical: 'Cutting Charge', ultimate: 'Breach Corridor', tacticalText: 'At a barrier: open a route without forcing it.', ultimateText: 'At a barrier: open it and shield the next advance.' }),
  signal: Object.freeze({ name: 'Signal', title: 'Field Observer', role: 'recon', colour: '#b684f4', passive: 'Field Observer', tactical: 'Survey Pulse', ultimate: 'Overwatch Network', tacticalText: 'On approach: reveal the defended route.', ultimateText: 'Reveal the route and suppress the next hazard.' }),
  remedy: Object.freeze({ name: 'Remedy', title: 'Recovery Lead', role: 'medic', colour: '#78dec0', passive: 'Triage', tactical: 'Trauma Station', ultimate: 'Emergency Extraction', tacticalText: 'Recover one casualty or restore health.', ultimateText: 'Recover up to two casualties and restore health.' }),
});

export const EXPEDITION_RULES = Object.freeze({
  commanderSlots: 2, launchSalvage: 30, durationMs: 10 * 60 * 1000,
  tacticalCooldownTurns: 2, maxRecoveryPerUnit: 1, maxCargoParts: 65,
  rapidPickupPercent: 75, heldPickupHazard: 50,
  pingLifetimeMs: 15 * 60 * 1000,
});
export const FIELD_UPGRADES = Object.freeze({
  route: 'Rapid Route · prevent 12 damage on the next advance',
  cover: 'Reactive Cover · restore 20 shield now',
  triage: 'Triage Kit · one extra recovery charge',
});
export const PING_TYPES = Object.freeze({
  scout: 'Scout this route', breach: 'Breach this barrier', supplies: 'Supplies needed',
  hold: 'Hold position', extract: 'Extraction ready',
});

const safeInt = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Math.min(Number(value), max) : 0;
const copy = value => JSON.parse(JSON.stringify(value));
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 160;
const activeStates = new Set(['active', 'extracted', 'failed', 'expired', 'withdrawn']);

export function newOperationsState() {
  return { selected: {}, attempts: {}, history: [], nextNumber: 1, rewardLedger: [], actionRecords: [], pings: [] };
}

export function normalizeOperationsState(raw, identities) {
  const state = newOperationsState();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return state;
  const allowed = new Map(identities.map(person => [person.id, person.communityId]));
  for (const [identityId, operativeId] of Object.entries(raw.selected || {})) {
    if (allowed.has(identityId) && OPERATIVES[operativeId]) state.selected[identityId] = operativeId;
  }
  for (const [identityId, source] of Object.entries(raw.attempts || {})) {
    if (!allowed.has(identityId) || !source || source.identityId !== identityId || source.communityId !== allowed.get(identityId) || !validId(source.id) || !OPERATIVES[source.operativeId]) continue;
    const roster = {};
    for (const role of Object.keys(SQUAD_ROLES)) roster[role] = safeInt(source.roster?.[role], 12);
    state.attempts[identityId] = {
      id: source.id, identityId, communityId: source.communityId, operativeId: source.operativeId, roster,
      startedAt: safeInt(source.startedAt), deadlineAt: safeInt(source.deadlineAt),
      status: activeStates.has(source.status) ? source.status : 'expired',
      phase: ['approach', 'barrier', 'cache', 'extraction'].includes(source.phase) ? source.phase : 'approach',
      turn: safeInt(source.turn, 20), health: safeInt(source.health, 100), shield: safeInt(source.shield, 60),
      casualties: safeInt(source.casualties, 12), recovered: safeInt(source.recovered, 12), recoveriesLeft: safeInt(source.recoveriesLeft, 3),
      scanned: Boolean(source.scanned), breached: Boolean(source.breached), cargo: safeInt(source.cargo, EXPEDITION_RULES.maxCargoParts),
      tacticalReadyTurn: safeInt(source.tacticalReadyTurn, 20), tacticalUses: safeInt(source.tacticalUses, 20),
      ultimateUsed: Boolean(source.ultimateUsed), fieldUpgrade: FIELD_UPGRADES[source.fieldUpgrade] ? source.fieldUpgrade : '',
      extractionMode: ['rapid', 'held'].includes(source.extractionMode) ? source.extractionMode : '',
      reward: safeInt(source.reward ?? (source.status === 'extracted' ? source.cargo : 0), EXPEDITION_RULES.maxCargoParts),
      routeProtection: safeInt(source.routeProtection, 24), signalProtection: safeInt(source.signalProtection, 24),
      events: Array.isArray(source.events) ? source.events.filter(event => event && typeof event.text === 'string').slice(-16).map(event => ({ text: event.text.slice(0, 180), at: safeInt(event.at) })) : [],
    };
  }
  state.history = Array.isArray(raw.history) ? raw.history.filter(record => record && validId(record.id) && allowed.get(record.identityId) === record.communityId && OPERATIVES[record.operativeId]).slice(-40).map(record => ({
    id: record.id, identityId: record.identityId, communityId: record.communityId, operativeId: record.operativeId,
    status: ['extracted', 'failed', 'expired', 'withdrawn'].includes(record.status) ? record.status : 'failed',
    reward: safeInt(record.reward, EXPEDITION_RULES.maxCargoParts), cargo: safeInt(record.cargo, EXPEDITION_RULES.maxCargoParts),
    scanned: Boolean(record.scanned), breached: Boolean(record.breached), recovered: safeInt(record.recovered, 12),
    finishedAt: safeInt(record.finishedAt), startedAt: safeInt(record.startedAt),
    extractionMode: ['rapid', 'held'].includes(record.extractionMode) ? record.extractionMode : '',
    fieldUpgrade: FIELD_UPGRADES[record.fieldUpgrade] ? record.fieldUpgrade : '',
    health: safeInt(record.health, 100), shield: safeInt(record.shield, 60),
    events: Array.isArray(record.events) ? record.events.filter(event => event && typeof event.text === 'string').slice(-16).map(event => ({ text: event.text.slice(0, 180), at: safeInt(event.at) })) : [],
  })) : [];
  state.rewardLedger = Array.isArray(raw.rewardLedger) ? raw.rewardLedger.filter(entry => entry && validId(entry.id) && allowed.has(entry.identityId)).slice(-100).map(entry => ({ id: entry.id, identityId: entry.identityId, amount: safeInt(entry.amount, EXPEDITION_RULES.maxCargoParts) })) : [];
  state.actionRecords = Array.isArray(raw.actionRecords) ? raw.actionRecords.filter(entry => entry && validId(entry.id) && allowed.has(entry.identityId) && typeof entry.kind === 'string' && entry.result).slice(-400).map(entry => ({ id: entry.id, identityId: entry.identityId, kind: entry.kind, result: copy(entry.result) })) : [];
  state.pings = Array.isArray(raw.pings) ? raw.pings.filter(ping => ping && validId(ping.id) && allowed.get(ping.identityId) === ping.communityId && PING_TYPES[ping.type]).slice(-30).map(ping => ({
    id: ping.id, identityId: ping.identityId, communityId: ping.communityId, type: ping.type,
    target: String(ping.target || '').slice(0, 70), at: safeInt(ping.at), expiresAt: safeInt(ping.expiresAt),
    acknowledgedBy: Array.isArray(ping.acknowledgedBy) ? ping.acknowledgedBy.filter(id => allowed.get(id) === ping.communityId).slice(0, 12) : [],
  })) : [];
  state.nextNumber = Math.max(1, safeInt(raw.nextNumber), ...Object.values(state.attempts).map(attempt => Number(attempt.id.match(/-(\d+)$/)?.[1] || 0) + 1), ...state.history.map(record => Number(record.id.match(/-(\d+)$/)?.[1] || 0) + 1));
  return state;
}

export class OperationsController {
  constructor(game) { this.game = game; }
  get state() { return this.game.state.operations; }
  now() { return this.game.now(); }
  selected(identityId = this.game.state.currentIdentityId) { return this.state.selected[identityId] || 'rivet'; }
  _access(identityId) { const result = this.game.getAccess(identityId); return result.allowed ? '' : result.reason; }
  _replay(identityId, kind, actionId) {
    if (!validId(actionId)) return { ok: false, error: 'A unique action ID is required.' };
    const prior = this.state.actionRecords.find(record => record.id === actionId);
    if (!prior) return null;
    return prior.identityId === identityId && prior.kind === kind ? { ...copy(prior.result), replay: true } : { ok: false, error: 'This action ID belongs to another action.' };
  }
  _record(identityId, kind, actionId, result) {
    this.state.actionRecords.push({ id: actionId, identityId, kind, result: copy(result) });
    this.state.actionRecords = this.state.actionRecords.slice(-400);
    this.game.save();
    return result;
  }
  _event(attempt, text) { attempt.events.push({ text, at: this.now() }); attempt.events = attempt.events.slice(-16); }
  _finish(attempt, status) {
    if (attempt.status !== 'active') return;
    attempt.status = status;
    const reward = status === 'extracted' ? attempt.extractionMode === 'rapid'
      ? Math.floor(attempt.cargo * EXPEDITION_RULES.rapidPickupPercent / 100) : attempt.cargo : 0;
    attempt.reward = reward;
    const ledgerId = `expedition:${attempt.id}`;
    if (reward && !this.state.rewardLedger.some(entry => entry.id === ledgerId)) {
      this.game.member(attempt.identityId).parts += reward;
      this.state.rewardLedger.push({ id: ledgerId, identityId: attempt.identityId, amount: reward });
    }
    this._event(attempt, status === 'extracted' ? `Convoy extracted ${reward} Parts to personal inventory.` : `Expedition ${status}; no cargo awarded.`);
    if (!this.state.history.some(entry => entry.id === attempt.id)) this.state.history.push({
      id: attempt.id, identityId: attempt.identityId, communityId: attempt.communityId, operativeId: attempt.operativeId,
      status, reward, cargo: attempt.cargo, scanned: attempt.scanned, breached: attempt.breached,
      recovered: attempt.recovered, finishedAt: this.now(), startedAt: attempt.startedAt,
      extractionMode: attempt.extractionMode, fieldUpgrade: attempt.fieldUpgrade,
      health: attempt.health, shield: attempt.shield, events: copy(attempt.events),
    });
    this.state.history = this.state.history.slice(-40);
    this.game.save();
  }
  current(identityId = this.game.state.currentIdentityId) {
    const attempt = this.state.attempts[identityId];
    if (attempt?.status === 'active' && this.now() >= attempt.deadlineAt) this._finish(attempt, 'expired');
    return attempt ? copy(attempt) : null;
  }
  getBoard(identityId = this.game.state.currentIdentityId) {
    const profile = this.game.profile(identityId);
    if (!profile) return { ok: false, error: 'Choose a preview identity.' };
    const current = this.current(identityId);
    const history = this.state.history.filter(record => record.identityId === identityId);
    const access = this.game.getAccess(identityId);
    const pings = access.allowed ? this.state.pings.filter(ping => ping.communityId === profile.communityId && ping.expiresAt > this.now()).map(ping => ({ ...ping, author: this.game.profile(ping.identityId)?.name || 'Member' })) : [];
    return { ok: true, selected: this.selected(identityId), current, history: copy(history), pings: copy(pings),
      capacity: 2 + this.game.community(identityId).saved.base.levels.hq * 2, access };
  }
  selectOperative(identityId, operativeId, actionId = this.game.newActionId('select-operative')) {
    const replay = this._replay(identityId, 'select-operative', actionId); if (replay) return replay;
    const error = this._access(identityId); if (error) return { ok: false, error };
    if (!OPERATIVES[operativeId]) return { ok: false, error: 'Unknown DZN operative.' };
    if (this.current(identityId)?.status === 'active') return { ok: false, error: 'The operative is locked until this expedition ends.' };
    this.state.selected[identityId] = operativeId;
    return this._record(identityId, 'select-operative', actionId, { ok: true, operativeId });
  }
  startExpedition(identityId, roster, actionId = this.game.newActionId('start-expedition')) {
    const replay = this._replay(identityId, 'start-expedition', actionId); if (replay) return replay;
    const error = this._access(identityId); if (error) return { ok: false, error };
    if (this.current(identityId)?.status === 'active') return { ok: false, error: 'Finish or withdraw from the current expedition first.' };
    const profile = this.game.profile(identityId), entry = this.game.community(identityId), member = this.game.member(identityId);
    if (member.salvage < EXPEDITION_RULES.launchSalvage) return { ok: false, error: `Need ${EXPEDITION_RULES.launchSalvage} personal Salvage to prepare the convoy.` };
    if (!roster || typeof roster !== 'object' || Array.isArray(roster) || Object.keys(roster).some(role => !SQUAD_ROLES[role])) return { ok: false, error: 'Choose valid ordinary troop roles.' };
    const troops = {}; let count = 0;
    for (const role of Object.keys(SQUAD_ROLES)) {
      const value = Number(roster[role] || 0);
      if (!Number.isSafeInteger(value) || value < 0 || value > 12) return { ok: false, error: 'Troop counts must be whole numbers between 0 and 12.' };
      if (value && !squadUnlocked(role, entry.saved.base.levels)) return { ok: false, error: `${SQUAD_ROLES[role].name} has not unlocked for this community.` };
      troops[role] = value; count += value;
    }
    const capacity = 2 + entry.saved.base.levels.hq * 2;
    if (count < 1 || count + EXPEDITION_RULES.commanderSlots > capacity) return { ok: false, error: `One operative uses 2 of ${capacity} command slots. Choose 1–${capacity - 2} ordinary troops.` };
    const id = `expedition-${this.state.nextNumber++}`;
    const attempt = { id, identityId, communityId: profile.communityId, operativeId: this.selected(identityId), roster: troops,
      startedAt: this.now(), deadlineAt: this.now() + EXPEDITION_RULES.durationMs, status: 'active', phase: 'approach', turn: 0,
      health: 100, shield: 40, casualties: 0, recovered: 0, recoveriesLeft: 1, scanned: false, breached: false, cargo: 0,
      tacticalReadyTurn: 0, tacticalUses: 0, ultimateUsed: false, fieldUpgrade: '', extractionMode: '', reward: 0,
      routeProtection: 0, signalProtection: 0, events: [] };
    member.salvage -= EXPEDITION_RULES.launchSalvage;
    this._event(attempt, `${OPERATIVES[attempt.operativeId].name} deployed with ${count} ordinary troops; 2 command slots reserved.`);
    this.state.attempts[identityId] = attempt;
    return this._record(identityId, 'start-expedition', actionId, { ok: true, attemptId: id, deadlineAt: attempt.deadlineAt, remainingSalvage: member.salvage });
  }
  _damage(attempt, amount) {
    const covered = Math.min(amount, attempt.routeProtection + attempt.signalProtection);
    let remainingProtection = covered;
    const routeUse = Math.min(attempt.routeProtection, remainingProtection); attempt.routeProtection -= routeUse; remainingProtection -= routeUse;
    attempt.signalProtection -= remainingProtection;
    let damage = amount - covered;
    const blocked = Math.min(attempt.shield, damage); attempt.shield -= blocked; damage -= blocked;
    attempt.health = Math.max(0, attempt.health - damage);
    return amount - covered;
  }
  chooseFieldUpgrade(identityId, upgradeId, actionId = this.game.newActionId('field-upgrade')) {
    const replay = this._replay(identityId, 'field-upgrade', actionId); if (replay) return replay;
    const error = this._access(identityId); if (error) return { ok: false, error };
    const attempt = this.current(identityId); if (!attempt || attempt.status !== 'active') return { ok: false, error: 'No active expedition.' };
    if (attempt.fieldUpgrade || attempt.phase === 'extraction') return { ok: false, error: 'Field Upgrades are chosen once before extraction.' };
    if (!FIELD_UPGRADES[upgradeId]) return { ok: false, error: 'Unknown Field Upgrade.' };
    const target = this.state.attempts[identityId]; target.fieldUpgrade = upgradeId;
    if (upgradeId === 'route') target.routeProtection += 12;
    if (upgradeId === 'cover') target.shield = Math.min(60, target.shield + 20);
    if (upgradeId === 'triage') target.recoveriesLeft = Math.min(2, target.recoveriesLeft + 1);
    this._event(target, `Field Upgrade: ${FIELD_UPGRADES[upgradeId]}. Expires with this attempt.`);
    return this._record(identityId, 'field-upgrade', actionId, { ok: true, upgradeId });
  }
  useAbility(identityId, kind, actionId = this.game.newActionId('operative-ability')) {
    const replay = this._replay(identityId, `ability-${kind}`, actionId); if (replay) return replay;
    const error = this._access(identityId); if (error) return { ok: false, error };
    const attempt = this.current(identityId); if (!attempt || attempt.status !== 'active') return { ok: false, error: 'No active expedition.' };
    const target = this.state.attempts[identityId], role = target.operativeId;
    if (!['tactical', 'ultimate'].includes(kind)) return { ok: false, error: 'Choose Tactical or Ultimate.' };
    if (kind === 'tactical' && target.turn < target.tacticalReadyTurn) return { ok: false, error: `Tactical ready after turn ${target.tacticalReadyTurn}.` };
    if (kind === 'ultimate' && target.ultimateUsed) return { ok: false, error: 'Ultimate already used this attempt.' };
    if (role === 'rivet' && target.phase !== 'barrier') return { ok: false, error: 'Rivet must target the barrier.' };
    if (role === 'signal' && target.phase !== 'approach' && target.phase !== 'barrier') return { ok: false, error: 'Signal needs an approach or barrier observation point.' };
    if (role === 'remedy' && target.casualties === 0 && target.health >= 100) return { ok: false, error: 'No casualty or health loss to treat.' };
    if (kind === 'ultimate') target.ultimateUsed = true; else { target.tacticalUses++; target.tacticalReadyTurn = target.turn + EXPEDITION_RULES.tacticalCooldownTurns; }
    if (role === 'rivet') { target.breached = true; target.phase = 'cache'; if (kind === 'ultimate') target.routeProtection += 18; }
    if (role === 'signal') { target.scanned = true; if (kind === 'ultimate') target.signalProtection += 18; }
    if (role === 'remedy') {
      const capacity = kind === 'ultimate' ? 2 : 1;
      const recovered = Math.min(target.casualties, target.recoveriesLeft, capacity);
      target.casualties -= recovered; target.recovered += recovered; target.recoveriesLeft -= recovered;
      target.health = Math.min(100, target.health + (kind === 'ultimate' ? 40 : 25));
    }
    this._event(target, `${OPERATIVES[role][kind]} activated. ${role === 'rivet' ? 'Barrier opened.' : role === 'signal' ? 'Threat intel updated.' : 'Bounded recovery applied.'}`);
    return this._record(identityId, `ability-${kind}`, actionId, { ok: true, kind, phase: target.phase, tacticalReadyTurn: target.tacticalReadyTurn });
  }
  advance(identityId, choice, actionId = this.game.newActionId('expedition-step')) {
    const replay = this._replay(identityId, 'expedition-step', actionId); if (replay) return replay;
    const error = this._access(identityId); if (error) return { ok: false, error };
    const attempt = this.current(identityId); if (!attempt || attempt.status !== 'active') return { ok: false, error: 'No active expedition.' };
    const target = this.state.attempts[identityId], troopCount = Object.values(target.roster).reduce((a, b) => a + b, 0);
    const valid = { approach: ['scout', 'push'], barrier: ['cut', 'force'], cache: ['secure', 'extra'], extraction: ['extract', 'hold'] };
    if (!valid[target.phase].includes(choice)) return { ok: false, error: 'That action is not available at this objective.' };
    if (target.phase === 'barrier' && choice === 'cut' && !target.roster.engineer) return { ok: false, error: 'A Combat Engineer or Rivet ability is needed to cut the barrier.' };
    target.turn++;
    if (target.phase === 'approach') {
      if (choice === 'scout') { target.scanned = true; this._damage(target, 5); target.phase = 'barrier'; this._event(target, 'Route scouted. Barrier and cache locations revealed.'); }
      else { this._damage(target, 20); target.casualties = Math.min(troopCount, target.casualties + 1); target.phase = 'barrier'; this._event(target, 'Unscouted push hit an ambush; one troop incapacitated.'); }
    } else if (target.phase === 'barrier') {
      target.breached = true; target.phase = 'cache';
      this._damage(target, choice === 'cut' ? 12 : 30);
      if (choice === 'force') target.casualties = Math.min(troopCount, target.casualties + 1);
      this._event(target, choice === 'cut' ? 'Engineer cut a controlled route through the shutter.' : 'Forced breach opened the shutter under heavy fire.');
    } else if (target.phase === 'cache') {
      target.cargo = choice === 'extra' ? 65 : 40;
      target.phase = 'extraction';
      this._damage(target, choice === 'extra' ? 45 : 15);
      if (choice === 'extra') target.casualties = Math.min(troopCount, target.casualties + 1);
      this._event(target, choice === 'extra' ? 'Extra cache secured; convoy exposed to severe hazard.' : 'Core cache secured; convoy moving to extraction.');
    } else {
      target.extractionMode = choice === 'hold' ? 'held' : 'rapid';
      if (choice === 'hold') {
        this._damage(target, EXPEDITION_RULES.heldPickupHazard);
        this._event(target, `Held the extraction beacon under ${EXPEDITION_RULES.heldPickupHazard} hazard pressure for the full cargo.`);
      } else this._event(target, `Rapid convoy pickup secured ${EXPEDITION_RULES.rapidPickupPercent}% of collected cargo without another hazard.`);
      this._finish(target, target.health === 0 ? 'failed' : 'extracted');
    }
    if (target.status === 'active' && target.health === 0) this._finish(target, 'failed');
    this.game.save();
    return this._record(identityId, 'expedition-step', actionId, { ok: true, choice, phase: target.phase, status: target.status, cargo: target.cargo, reward: target.reward, health: target.health, shield: target.shield });
  }
  withdraw(identityId, actionId = this.game.newActionId('expedition-withdraw')) {
    const replay = this._replay(identityId, 'expedition-withdraw', actionId); if (replay) return replay;
    const error = this._access(identityId); if (error) return { ok: false, error };
    const attempt = this.current(identityId); if (!attempt || attempt.status !== 'active') return { ok: false, error: 'No active expedition.' };
    this._finish(this.state.attempts[identityId], 'withdrawn');
    return this._record(identityId, 'expedition-withdraw', actionId, { ok: true, status: 'withdrawn' });
  }
  prepareNext(identityId, actionId = this.game.newActionId('expedition-prepare')) {
    const replay = this._replay(identityId, 'expedition-prepare', actionId); if (replay) return replay;
    const error = this._access(identityId); if (error) return { ok: false, error };
    const attempt = this.current(identityId);
    if (attempt?.status === 'active') return { ok: false, error: 'This expedition is still active.' };
    delete this.state.attempts[identityId];
    return this._record(identityId, 'expedition-prepare', actionId, { ok: true });
  }
  postPing(identityId, type, target, actionId = this.game.newActionId('operation-ping')) {
    const replay = this._replay(identityId, 'operation-ping', actionId); if (replay) return replay;
    const error = this._access(identityId); if (error) return { ok: false, error };
    if (!PING_TYPES[type]) return { ok: false, error: 'Choose a known signal.' };
    const cleanTarget = String(target || '').trim().slice(0, 70);
    if (!cleanTarget) return { ok: false, error: 'Choose a target or objective.' };
    const profile = this.game.profile(identityId);
    const ping = { id: `ping-${this.game.newActionId('local')}`, identityId, communityId: profile.communityId, type, target: cleanTarget,
      at: this.now(), expiresAt: this.now() + EXPEDITION_RULES.pingLifetimeMs, acknowledgedBy: [] };
    this.state.pings.push(ping); this.state.pings = this.state.pings.slice(-30);
    return this._record(identityId, 'operation-ping', actionId, { ok: true, pingId: ping.id });
  }
  acknowledgePing(identityId, pingId, actionId = this.game.newActionId('ack-ping')) {
    const replay = this._replay(identityId, 'ack-ping', actionId); if (replay) return replay;
    const error = this._access(identityId); if (error) return { ok: false, error };
    const ping = this.state.pings.find(item => item.id === pingId && item.communityId === this.game.profile(identityId).communityId && item.expiresAt > this.now());
    if (!ping) return { ok: false, error: 'Signal expired or belongs to another community.' };
    if (ping.acknowledgedBy.includes(identityId)) return { ok: false, error: 'Already acknowledged.' };
    ping.acknowledgedBy.push(identityId);
    return this._record(identityId, 'ack-ping', actionId, { ok: true, pingId });
  }
  showcase(identityId = this.game.state.currentIdentityId) {
    const history = this.state.history.filter(record => record.identityId === identityId && record.status === 'extracted');
    const mastery = Object.fromEntries(Object.keys(OPERATIVES).map(id => [id, history.filter(record => record.operativeId === id).length]));
    return { mastery, completed: history.length, earned: {
      firstThrough: history.some(record => record.breached),
      eyesOnTarget: history.some(record => record.scanned),
      siegeMedic: history.some(record => record.recovered > 0),
    }, evidence: copy(history.slice(-8)) };
  }
}
