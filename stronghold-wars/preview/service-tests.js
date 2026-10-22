import { GAME_CONFIG, LocalGameService, CORRUPT_BACKUP_PREFIX, LEGACY_BACKUP_KEY, LEGACY_STORAGE_KEY, SERVICE_STORAGE_KEY, V2_BACKUP_KEY, V2_STORAGE_KEY, WAR_RULES } from './game-service.js';
import { buildingScaffoldState, reconcileBuildingSnapshot } from './game-runtime-state.js';

class MemoryStorage {
  constructor(seed = {}) { this.data = new Map(Object.entries(seed)); }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { this.data.set(key, String(value)); }
}

function assert(condition, message) {
  if (!condition) throw new Error(`Local service check failed: ${message}`);
}

export function runServiceTests() {
  const checks = [];
  let clock = 1_900_000_000_000;
  const storage = new MemoryStorage();
  let service = new LocalGameService({ storage, now: () => clock });

  let result = service.approveProject('iron-owner', 'hq', 'test-approve-hq2');
  assert(result.ok, 'owner approves the first Hall project');
  const hallProjectId = result.projectId;
  result = service.contributeToProject('iron-member', hallProjectId, 200, 'test-donate-partial');
  assert(result.ok && result.accepted === 200 && !result.completed, 'member makes a partial project donation');
  const partsAfterPartial = service.snapshot('iron-member').member.parts;
  const replayDonation = service.contributeToProject('iron-member', hallProjectId, 200, 'test-donate-partial');
  assert(replayDonation.ok && replayDonation.replay && service.snapshot('iron-member').member.parts === partsAfterPartial, 'replayed donation action does not debit twice');
  assert(service.snapshot('iron-owner').base.levels.hq === 1, 'partial funding does not advance the Hall');
  result = service.contributeToProject('iron-admin', hallProjectId, 400, 'test-donate-final');
  assert(result.ok && result.accepted === 400 && result.completed, 'final donation completes the project');
  assert(service.snapshot('iron-owner').base.levels.hq === 2, 'Hall advances exactly once on full funding');
  assert(service.snapshot('iron-member').base.levels.hq === 2, 'two members observe the same shared base');
  assert(service.snapshot('iron-owner').member.lifetimeContributed === 0, 'leadership allocation is not counted as a personal contribution');
  assert(service.snapshot('iron-member').member.lifetimeContributed === 200, 'personal contribution lifetime total is recorded');
  const hallLevelAfterFunding = service.snapshot('iron-owner').base.levels.hq;
  assert(!service.contributeToProject('iron-member', hallProjectId, 1, 'test-donate-after-completion').ok, 'completed projects reject new contributions');
  assert(service.snapshot('iron-owner').base.levels.hq === hallLevelAfterFunding, 'a completed project cannot advance the building a second time');
  checks.push('project approval, partial and replayed donations, exact one-time completion, shared Hall level and donor totals');

  const hallGate = service.getUpgradeRequirement('iron-owner', 'hq');
  assert(!hallGate.ok && hallGate.prerequisites.length === 3, 'Hall 3 is gated by all three support buildings at Level 2');
  assert(!service.approveProject('iron-member', 'workshop', 'test-member-cannot-approve').ok, 'members cannot approve projects');
  assert(!service.allocateTreasury('iron-member', hallProjectId, 1, 'test-member-cannot-allocate').ok, 'members cannot allocate community treasury');
  assert(!service.pinProject('iron-member', hallProjectId, true, 'test-member-cannot-pin').ok, 'members cannot pin community priorities');

  service.community('iron-owner').saved.base.treasury = 500;
  service.save(); // Seed adequate shared funds to exercise a treasury-only completion below.
  const workshop = service.approveProject('iron-owner', 'workshop', 'test-approve-workshop');
  assert(workshop.ok, 'leadership can approve an eligible support project');
  result = service.allocateTreasury('iron-admin', workshop.projectId, 120, 'test-allocate-workshop-partial');
  assert(result.ok && result.accepted === 120 && result.remaining === 130 && !result.completed, 'leadership allocates existing treasury to project funding');
  assert(service.snapshot('iron-owner').base.treasury === 380, 'treasury allocation debits the shared unallocated balance');
  assert(service.snapshot('iron-admin').member.lifetimeContributed === 400, 'treasury allocation is not recorded as a personal donation');
  result = service.contributeToProject('iron-member', workshop.projectId, 130, 'test-workshop-final-donation');
  assert(result.ok && result.completed && service.snapshot('iron-owner').base.levels.workshop === 2, 'personal donation completes a partially treasury-funded project exactly once');
  const workshopParts = service.snapshot('iron-member').member.parts;
  const workshopLevel = service.snapshot('iron-owner').base.levels.workshop;
  const repeatedWorkshop = service.contributeToProject('iron-member', workshop.projectId, 130, 'test-workshop-final-donation');
  assert(repeatedWorkshop.replay && service.snapshot('iron-member').member.parts === workshopParts, 'replayed final funding action does not debit twice');
  assert(service.snapshot('iron-owner').base.levels.workshop === workshopLevel, 'replayed funding cannot repeat project completion');

  const tower = service.approveProject('iron-owner', 'tower', 'test-approve-tower');
  assert(tower.ok, 'tower project can be approved at Hall Level 2');
  const treasuryPartial = service.allocateTreasury('iron-owner', tower.projectId, 80, 'test-tower-treasury-partial');
  assert(treasuryPartial.ok && treasuryPartial.accepted === 80 && !treasuryPartial.completed, 'treasury allocation can partially fund a second project');
  const treasuryFinish = service.allocateTreasury('iron-admin', tower.projectId, 500, 'test-tower-treasury-final');
  assert(treasuryFinish.ok && treasuryFinish.accepted === 170 && treasuryFinish.completed, 'allocation is capped to remaining project cost and completes the project');
  const towerLevel = service.snapshot('iron-owner').base.levels.tower;
  const towerTreasury = service.snapshot('iron-owner').base.treasury;
  const replayAllocation = service.allocateTreasury('iron-admin', tower.projectId, 500, 'test-tower-treasury-final');
  assert(replayAllocation.replay && service.snapshot('iron-owner').base.levels.tower === towerLevel && service.snapshot('iron-owner').base.treasury === towerTreasury, 'replayed treasury allocation cannot pay or complete twice');
  assert(!service.allocateTreasury('iron-admin', tower.projectId, 1, 'test-tower-after-completion').ok, 'completed project rejects a second treasury allocation');
  assert(service.snapshot('iron-owner').base.treasury === 130, 'treasury allocation never makes the shared balance negative and keeps the unspent remainder');
  checks.push('treasury allocation, balance conservation, role restrictions and one-time completion');

  const pinService = new LocalGameService({ storage: new MemoryStorage(), now: () => clock });
  // Seed a review fixture with four eligible approved records. The progression
  // gates normally limit simultaneous projects, so this isolates the pin cap.
  const pinBase = pinService.community('iron-owner').saved.base;
  pinBase.projects = ['hq', 'workshop', 'tower', 'comms'].map((key, index) => ({
    id: `pin-fixture-${index}`, key, targetLevel: 2, targetAmount: 100, funded: 0,
    benefit: 'fixture', prerequisites: [], status: 'approved', pinned: false,
    createdAt: clock + index, completedAt: 0, donors: [],
  }));
  const pinProjects = pinBase.projects;
  for (const project of pinProjects.slice(0, 3)) assert(pinService.pinProject('iron-owner', project.id, true, `pin-three-${project.id}`).ok, 'leadership can pin one of three priority slots');
  assert(!pinService.pinProject('iron-owner', pinProjects[3].id, true, 'pin-fourth-project').ok, 'the fourth pinned project is rejected');
  assert(pinService.pinProject('iron-admin', pinProjects[0].id, false, 'unpin-one-project').ok, 'leadership can free a priority slot');
  assert(pinService.pinProject('iron-owner', pinProjects[3].id, true, 'pin-after-unpin').ok, 'a freed priority slot can be reused');
  checks.push('three-project pin limit and leadership-only pin management');

  assert(service.snapshot('violet-owner').base.levels.hq === 1, 'a different eligible community has an isolated Hall');
  assert(!service.getAccess('iron-unverified').allowed, 'unverified connected identity is locked');
  assert(!service.getAccess('free-owner').allowed, 'Free-tier community is locked');
  service.setOwnerProActive('violet-owner', false);
  assert(!service.getAccess('violet-member').allowed, 'inactive owner Pro locks members');
  service.setOwnerProActive('violet-owner', true);
  assert(service.getAccess('violet-member').allowed, 'reactivating owner Pro restores access to the preserved base');
  checks.push('member sharing, community isolation, verification, Free tier and inactive owner Pro entitlement');

  const landStorage = new MemoryStorage();
  let landService = new LocalGameService({ storage: landStorage, now: () => clock });
  assert(!landService.chopTree('iron-member', 'timberline-depot', 'land-too-low').ok, 'Hall level gates work on new districts');
  landService.community('iron-owner').saved.base.levels.hq = 2;
  assert(!landService.chopTree('iron-unverified', 'timberline-depot', 'land-unverified').ok, 'unverified identity cannot earn Timber');
  assert(!landService.chopTree('free-owner', 'timberline-depot', 'land-free').ok, 'Free preview identity cannot clear trees');
  assert(!landService.approveLandClaim('iron-owner', 'timberline-depot', 'land-too-early').ok, 'owner cannot approve a standing forest');
  for (let i = 0; i < 3; i++) assert(landService.chopTree('iron-member', 'timberline-depot', `land-chop-${i}`).ok, 'verified member can clear a tree');
  const timberBeforeReplay = landService.member('iron-member').timber;
  assert(landService.chopTree('iron-member', 'timberline-depot', 'land-chop-0').replay && landService.member('iron-member').timber === timberBeforeReplay, 'replayed chop does not grant Timber again');
  assert(!landService.chopTree('iron-admin', 'timberline-depot', 'land-chop-0').ok, 'a chop action ID cannot be reused by another actor');
  assert(landService.snapshot('iron-owner').base.landPlots[1].status === 'cleared', 'tree clearing changes shared plot state');
  assert(!landService.approveLandClaim('iron-member', 'timberline-depot', 'land-member-approve').ok, 'member cannot approve main infrastructure');
  assert(landService.approveLandClaim('iron-owner', 'timberline-depot', 'land-owner-approve').ok, 'owner approves shared claim');
  assert(landService.contributeTimber('iron-member', 'timberline-depot', 60, 'land-fund').status === 'claimed', 'member Timber funds and claims shared land');
  assert(landService.buildBarricade('iron-member', 'timberline-depot', 'land-barricade').ok, 'member builds a defence on claimed land');
  assert(!landService.buildBarricade('iron-member', 'timberline-depot', 'land-no-wood').ok, 'barricade cost cannot be bypassed');
  landService = new LocalGameService({ storage: landStorage, now: () => clock });
  assert(landService.snapshot('iron-owner').base.landPlots[1].barricades === 1 && landService.member('iron-member').timber === 0, 'claimed land, defence and exact remaining Timber survive reload');
  checks.push('tree clearing, personal Timber, owner approval, member construction, entitlement gates, action replay and save persistence');

  const trainingService = new LocalGameService({ storage: new MemoryStorage(), now: () => clock });
  const trainingStartParts = trainingService.snapshot('iron-owner').member.parts;
  assert(!trainingService.recordTrainingVictory('iron-owner', 1, 300).ok, 'an unrecorded training encounter cannot claim a reward');
  assert(trainingService.recordTrainingAttempt(1).ok, 'a training attempt is recorded before the encounter');
  result = trainingService.recordTrainingVictory('iron-owner', 1, 300);
  assert(result.ok && result.reward === 300, 'training victory reward is applied through the local service');
  const afterTrainingReward = trainingService.snapshot('iron-owner').member.parts;
  assert(afterTrainingReward === trainingStartParts + 300, 'training reward credits the current member inventory');
  assert(!trainingService.recordTrainingVictory('iron-owner', 1, 300).ok && trainingService.snapshot('iron-owner').member.parts === afterTrainingReward, 'repeated raid victory cannot claim twice');
  checks.push('recorded AI training attempt, member reward and duplicate-victory protection');

  const salvageClaim = service.claimDailySalvage('iron-owner');
  assert(salvageClaim.ok && salvageClaim.amount === GAME_CONFIG.dailySalvage, 'daily resupply is claimed by stable member identity');
  const firstNextClaim = salvageClaim.nextClaimAt;
  assert(!service.claimDailySalvage('iron-owner').ok && service.snapshot('iron-owner').member.nextClaimAt === firstNextClaim, 'daily resupply cannot be repeated by reopening the panel');
  clock += 10_000;
  service = new LocalGameService({ storage, now: () => clock });
  assert(!service.claimDailySalvage('iron-owner').ok, 'daily claim remains unavailable after refreshing the service');
  assert(service.claimDailySalvage('iron-admin').ok, 'daily claims are stable per member identity rather than shared by the community');
  clock += 24 * 60 * 60 * 1000;
  assert(service.claimDailySalvage('iron-owner').ok, 'daily Salvage becomes available again after its cooldown');

  const beforeForgeParts = service.snapshot('iron-owner').member.parts;
  const forge = service.startForgeJob('iron-owner', 'field-parts', 'test-forge-start');
  assert(forge.ok, 'Forge job starts and takes Salvage');
  const storedFinish = service.snapshot('iron-owner').member.forgeJobs.find(job => job.id === forge.jobId).finishAt;
  clock += 5_000;
  service = new LocalGameService({ storage, now: () => clock });
  let forgeJobs = service.processForge('iron-owner');
  let persistedJob = forgeJobs.find(job => job.id === forge.jobId);
  assert(persistedJob.status === 'working' && persistedJob.finishAt === storedFinish, 'working Forge job survives refresh with stable finish time');
  clock += 10_000;
  forgeJobs = service.processForge('iron-owner');
  assert(forgeJobs.find(job => job.id === forge.jobId).status === 'ready', 'Forge job becomes ready at its persisted finish time');
  result = service.claimForgeJob('iron-owner', forge.jobId);
  assert(result.ok && result.amount === 80, 'ready Forge output is claimed once');
  const afterClaim = service.snapshot('iron-owner').member.parts;
  assert(afterClaim === beforeForgeParts + 80, 'Forge output credits the personal Parts balance');
  result = service.claimForgeJob('iron-owner', forge.jobId);
  assert(!result.ok && /already been claimed/.test(result.error), 'repeated Forge claim is rejected');
  assert(service.snapshot('iron-owner').member.parts === afterClaim, 'repeated claim does not duplicate output');
  checks.push('daily Salvage stability, Forge debit, refresh during work, ready, one-time claim and duplicate-claim guard');

  const legacyRaw = JSON.stringify({ parts: 321, stored: 8.5, treasury: 77, levels: { hq: 2, workshop: 2, tower: 1, comms: 1 }, upgrades: { tower: { end: clock + 60_000 } }, raidCount: 4, lastRaidClaimed: 3, muted: true });
  const legacyStorage = new MemoryStorage({ [LEGACY_STORAGE_KEY]: legacyRaw });
  const migrated = new LocalGameService({ storage: legacyStorage, now: () => clock });
  assert(legacyStorage.getItem(LEGACY_BACKUP_KEY) === legacyRaw, 'legacy save is preserved byte-for-byte in a versioned backup');
  assert(migrated.snapshot('iron-owner').member.parts === 321 && migrated.snapshot('iron-owner').base.treasury === 77, 'legacy personal and community balances migrate exactly once');
  assert(migrated.snapshot('iron-member').member.parts === 0, 'legacy balances are not copied to other preview identities');
  assert(migrated.snapshot('iron-owner').base.legacyJobs.length === 1, 'already-paid legacy upgrade is retained as a one-time finishing job');
  const migratedAgain = new LocalGameService({ storage: legacyStorage, now: () => clock });
  assert(migratedAgain.snapshot('iron-owner').member.parts === 321, 'refresh does not repeat the legacy migration or starter grant');
  clock += 60_000;
  assert(migratedAgain.processLegacyJobs('iron-owner').join(',') === 'tower', 'a completed legacy construction job advances its building once');
  assert(migratedAgain.snapshot('iron-owner').base.levels.tower === 2 && migratedAgain.snapshot('iron-owner').base.legacyJobs.length === 0, 'completed legacy job is removed and its resulting level persists');
  assert(migratedAgain.processLegacyJobs('iron-owner').length === 0 && migratedAgain.snapshot('iron-owner').base.levels.tower === 2, 'refreshing/reprocessing a completed legacy job does not grant another level');
  const partialSaveStorage = new MemoryStorage({ [SERVICE_STORAGE_KEY]: '{}' });
  const recovered = new LocalGameService({ storage: partialSaveStorage, now: () => clock });
  assert(recovered.snapshot('iron-owner').member.parts === 0 && recovered.snapshot('iron-owner').base.treasury === 0, 'partial existing v2 saves do not receive new-game starter balances');
  const corruptSaveStorage = new MemoryStorage({ [SERVICE_STORAGE_KEY]: 'null' });
  const corruptRecovery = new LocalGameService({ storage: corruptSaveStorage, now: () => clock });
  assert(corruptRecovery.snapshot('iron-owner').member.parts === 0 && corruptRecovery.snapshot('iron-owner').base.treasury === 0, 'malformed existing v2 records open without starter balances');
  checks.push('one-time v1 migration, raw backup, completed legacy job, no duplicate resources and safe partial-save recovery');

  const forgeClockStart = clock + 10_000;
  let forgeClock = forgeClockStart;
  const queuedStorage = new MemoryStorage();
  let queuedService = new LocalGameService({ storage: queuedStorage, now: () => forgeClock });
  queuedService.setMemberValue('iron-owner', 'salvage', 500);
  const queuedOne = queuedService.startForgeJob('iron-owner', 'field-parts', 'offline-queue-one');
  const queuedTwo = queuedService.startForgeJob('iron-owner', 'field-parts', 'offline-queue-two');
  let queuedJobs = queuedService.snapshot('iron-owner').member.forgeJobs;
  const firstSchedule = queuedJobs.find(job => job.id === queuedOne.jobId);
  const secondSchedule = queuedJobs.find(job => job.id === queuedTwo.jobId);
  assert(firstSchedule.slot === 1 && secondSchedule.slot === 1 && secondSchedule.startedAt === firstSchedule.finishAt, 'single-slot queue schedules second work against the actual preceding finish');
  assert(secondSchedule.startedAt >= secondSchedule.queuedAt && secondSchedule.finishAt === forgeClockStart + 30_000, 'queued work never starts before its queue time and persists its full schedule');
  forgeClock += 7_500;
  queuedService = new LocalGameService({ storage: queuedStorage, now: () => forgeClock });
  queuedJobs = queuedService.processForge('iron-owner');
  assert(queuedJobs.find(job => job.id === queuedOne.jobId).status === 'working' && queuedJobs.find(job => job.id === queuedTwo.jobId).status === 'queued', 'halfway refresh preserves active work and its next slot schedule');
  forgeClock = forgeClockStart + 60_000;
  queuedService = new LocalGameService({ storage: queuedStorage, now: () => forgeClock });
  queuedJobs = queuedService.processForge('iron-owner');
  assert(queuedJobs.filter(job => [queuedOne.jobId, queuedTwo.jobId].includes(job.id)).every(job => job.status === 'ready'), 'two serial 15-second Forge jobs are both ready after 60 seconds offline');
  const queuedBeforeClaims = queuedService.snapshot('iron-owner').member.parts;
  assert(queuedService.claimForgeJob('iron-owner', queuedOne.jobId).ok && !queuedService.claimForgeJob('iron-owner', queuedOne.jobId).ok, 'each offline Forge result requires an explicit once-only claim');
  assert(queuedService.snapshot('iron-owner').member.parts === queuedBeforeClaims + 80, 'duplicate offline claim never awards output twice');

  forgeClock += 1_000;
  const multiSlotStorage = new MemoryStorage();
  const multiSlot = new LocalGameService({ storage: multiSlotStorage, now: () => forgeClock });
  multiSlot.setMemberValue('iron-owner', 'salvage', 500);
  const persistentJob = multiSlot.startForgeJob('iron-owner', 'field-parts', 'slot-upgrade-one');
  const beforeSlotIncrease = multiSlot.snapshot('iron-owner').member.forgeJobs.find(job => job.id === persistentJob.jobId);
  multiSlot.community('iron-owner').saved.base.levels.hq = 3;
  const unlockedJob = multiSlot.startForgeJob('iron-owner', 'field-parts', 'slot-upgrade-two');
  const multiJobs = multiSlot.snapshot('iron-owner').member.forgeJobs;
  const preserved = multiJobs.find(job => job.id === persistentJob.jobId);
  const parallel = multiJobs.find(job => job.id === unlockedJob.jobId);
  assert(multiSlot.forgeSlotCount('iron-owner') === 2 && preserved.startedAt === beforeSlotIncrease.startedAt && preserved.finishAt === beforeSlotIncrease.finishAt, 'HQ slot increase preserves already-paid active Forge timestamps');
  assert(parallel.slot === 2 && parallel.startedAt === forgeClock, 'newly available HQ slot starts subsequent work in parallel');
  checks.push('authoritative-clock Forge queue scheduling, offline catch-up, halfway refresh, stable HQ slot increases and once-only claims');

  const corruptRaw = '{"schemaVersion":2,"communities":oops';
  const corruptQuarantineStorage = new MemoryStorage({ [SERVICE_STORAGE_KEY]: corruptRaw });
  const corruptQuarantine = new LocalGameService({ storage: corruptQuarantineStorage, now: () => clock, logger: { error() {} } });
  const backups = [...corruptQuarantineStorage.data.entries()].filter(([key]) => key.startsWith(CORRUPT_BACKUP_PREFIX));
  assert(backups.length === 1 && backups[0][1] === corruptRaw, 'invalid V2 JSON is quarantined byte-for-byte under a versioned key before recovery save');
  assert(corruptQuarantine.snapshot('iron-owner').member.parts === 0 && corruptQuarantine.snapshot('iron-owner').base.treasury === 0, 'corrupt-save recovery grants no starter balances');
  assert(corruptQuarantine.state.recoveryNotice && JSON.parse(corruptQuarantineStorage.getItem(SERVICE_STORAGE_KEY)).recoveryNotice, 'recovery notice is clear and persists across reload');
  new LocalGameService({ storage: corruptQuarantineStorage, now: () => clock }).save();
  assert([...corruptQuarantineStorage.data.keys()].filter(key => key.startsWith(CORRUPT_BACKUP_PREFIX)).length === 1, 'recovery autosaves do not create duplicate corrupt backups');
  checks.push('versioned exact-payload corrupt-save quarantine, zero-balance recovery notice and idempotent autosave');

  const revealEffects = new Map([['hq', clock + GAME_CONFIG.revealSeconds * 1000]]);
  assert(buildingScaffoldState({ revealEffects, now: clock }).hq, 'fully funded reveal scaffold is visible before its deadline');
  assert(!buildingScaffoldState({ revealEffects, now: clock + GAME_CONFIG.revealSeconds * 1000 }).hq && revealEffects.size === 0, 'reveal scaffold expires exactly at its 2.5-second deadline without another UI click');
  const legacyReveal = new Map([['tower', clock + 1_000]]);
  assert(buildingScaffoldState({ legacyJobs: [{ key: 'tower' }], revealEffects: legacyReveal, now: clock + 2_000 }).tower, 'legacy timed construction keeps its scaffold after a reveal deadline');
  assert(!buildingScaffoldState({ legacyJobs: [], revealEffects: legacyReveal, now: clock + 2_000 }).tower, 'completed legacy construction removes its scaffold once no job or reveal remains');
  const sameCommunity = reconcileBuildingSnapshot('iron-pines', 'iron-pines', { hq: 2, workshop: 1, tower: 1, comms: 1 }, { hq: 2, workshop: 1, tower: 1, comms: 1 });
  const switchedCommunity = reconcileBuildingSnapshot('iron-pines', 'violet-ridge', { hq: 1, workshop: 1, tower: 1, comms: 1 }, sameCommunity.levels);
  assert(!sameCommunity.communityChanged && sameCommunity.changedKeys.length === 0, 'same-community identity switch retains the shared base meshes');
  assert(switchedCommunity.communityChanged && switchedCommunity.changedKeys.length === 4 && switchedCommunity.levels.hq === 1, 'cross-community switch reconciles every displayed building to that community level snapshot');
  checks.push('automatic scaffold reveal expiry, legacy scaffold reconciliation and same-/cross-community presentation reconciliation');

  let warClock = clock + 5_000;
  const warStorage = new MemoryStorage();
  const warService = new LocalGameService({ storage: warStorage, now: () => warClock });
  for (const communityId of ['iron-pines', 'violet-ridge']) {
    const community = warService.state.communities[communityId];
    community.proActive = true;
    community.base.levels = { hq: 3, workshop: 2, tower: 2, comms: 2 };
  }
  warService.save();
  const startingReadiness = warService.getWarReadiness('iron-pines', 'iron-owner');
  assert(startingReadiness.eligible, 'Hall 3, support Level 2, owner Pro and verified membership make Iron Pines ready');
  const lockedReadiness = warService.getWarReadiness('mossback-free', 'free-owner');
  assert(!lockedReadiness.eligible && lockedReadiness.unmetGates.some(gate => /Free preview is locked/.test(gate)), 'Free community receives an explicit locked eligibility gate');
  const unverifiedReadiness = warService.getWarReadiness('iron-pines', 'iron-unverified');
  assert(!unverifiedReadiness.eligible && unverifiedReadiness.unmetGates.some(gate => /unverified/.test(gate)), 'unverified members are individually locked even when their community is ready');
  warService.setOwnerProActive('violet-owner', false);
  assert(warService.getWarReadiness('violet-ridge', 'violet-owner').unmetGates.some(gate => /owner Pro must be active/.test(gate)), 'inactive community-owner Pro—not a member entitlement—blocks war readiness');
  assert(!warService.challengeWar('iron-owner', 'violet-ridge', 'war-inactive-opponent').ok, 'a challenge is rejected while the opposing owner Pro is inactive');
  warService.setOwnerProActive('violet-owner', true);
  warService.state.communities['violet-ridge'].base.levels.hq = 2;
  assert(!warService.challengeWar('iron-owner', 'violet-ridge', 'war-low-hall').ok, 'opponent Hall below Level 3 blocks a challenge');
  warService.state.communities['violet-ridge'].base.levels.hq = 3;
  assert(!warService.challengeWar('iron-member', 'violet-ridge', 'war-member-challenge').ok, 'ordinary members cannot issue challenges');
  assert(!warService.challengeWar('iron-owner', 'iron-pines', 'war-self-challenge').ok, 'self-challenges are rejected');
  for (let i = 0; i < 3; i++) assert(warService.chopTree('violet-member', 'timberline-depot', `war-defence-chop-${i}`).ok, 'defending community clears its land');
  assert(warService.approveLandClaim('violet-owner', 'timberline-depot', 'war-defence-approve').ok, 'defending owner approves land');
  assert(warService.contributeTimber('violet-member', 'timberline-depot', 60, 'war-defence-fund').ok, 'defending member funds land');
  assert(warService.buildBarricade('violet-member', 'timberline-depot', 'war-defence-barricade').ok, 'defending member builds barricade');
  checks.push('war eligibility gates for owner Pro, Free tier, verification, Hall/support levels and leadership-only challenges');

  const challenge = warService.challengeWar('iron-owner', 'violet-ridge', 'war-challenge-once');
  assert(challenge.ok && challenge.state === 'challenged', 'eligible owner creates a pending challenge');
  const challengeReplay = warService.challengeWar('iron-owner', 'violet-ridge', 'war-challenge-once');
  assert(challengeReplay.ok && challengeReplay.replay && challengeReplay.warId === challenge.warId && warService.state.wars.length === 1, 'challenge action ID replay returns the same war without creating a duplicate');
  assert(!warService.challengeWar('iron-admin', 'violet-ridge', 'war-second-active').ok, 'a second active challenge is rejected');
  assert(!warService.acceptWarChallenge('violet-member', challenge.warId, 'war-member-accept').ok, 'opposing members cannot accept on behalf of leadership');
  const accepted = warService.acceptWarChallenge('violet-owner', challenge.warId, 'war-accept-once');
  assert(accepted.ok && accepted.state === 'preparation', 'opposing owner accepts and begins finite preparation');
  const warRecord = warService.getWar(challenge.warId);
  assert(warRecord.snapshots.challenger.base.levels.hq === 3 && warRecord.snapshots.defender.base.levels.tower === 2, 'war record locks both communities’ pre-war base snapshots');
  assert(warRecord.snapshots.defender.stats.fortification === 1 && warRecord.snapshots.defender.base.landPlots[1].barricades === 1, 'war snapshot includes the defender’s built district and barricade');
  warService.state.communities['violet-ridge'].base.levels.tower = 5;
  warService.state.communities['violet-ridge'].base.landPlots[1].barricades = 0;
  assert(warService.getWar(challenge.warId).snapshots.defender.base.levels.tower === 2, 'later base changes cannot mutate the immutable captured battle stats');
  assert(warService.getWar(challenge.warId).snapshots.defender.stats.fortification === 1, 'later demolition cannot alter locked defensive fortification');
  assert(!warService.startWar('violet-owner', challenge.warId, 'war-start-too-early').ok, 'war cannot start before the preparation countdown');
  warClock += WAR_RULES.preparationReadyMs;
  const started = warService.startWar('violet-admin', challenge.warId, 'war-start-once');
  assert(started.ok && started.state === 'active' && started.attackEndsAt === warClock + WAR_RULES.attackWindowMs, 'an opposing owner/admin starts a bounded attack window after preparation');
  checks.push('challenge inbox lifecycle, opposing acceptance, immutable snapshots, prep timer and attack-window start');

  const lockedWar = warService.getWar(challenge.warId);
  const attackerStats = lockedWar.snapshots.challenger.base.levels;
  const defenderStats = lockedWar.snapshots.defender.base.levels;
  const expectedAssault = Math.max(0, Math.min(100, Math.round(20 + attackerStats.hq * 12 + attackerStats.tower * 16 + attackerStats.comms * 4 - defenderStats.hq * 4 - defenderStats.tower * 10 - 3)));
  const ironStartParts = warService.snapshot('iron-owner').member.parts;
  const assault = warService.submitWarAttack('iron-owner', challenge.warId, 'assault', 'war-iron-assault');
  assert(assault.ok && assault.score === expectedAssault && assault.attackId && assault.feedback.includes('counterfire'), 'Assault score and visible defence feedback derive from locked snapshots');
  const duplicateAssault = warService.submitWarAttack('iron-owner', challenge.warId, 'recon', 'war-iron-assault');
  assert(duplicateAssault.ok && duplicateAssault.replay && duplicateAssault.attackId === assault.attackId && warService.getWar(challenge.warId).attacks.length === 1, 'a repeated action ID is replay-safe and cannot deploy a second attack');
  assert(!warService.submitWarAttack('iron-admin', challenge.warId, 'recon', 'war-iron-assault').ok, 'action IDs cannot be reused by another identity');
  assert(!warService.submitWarAttack('iron-owner', challenge.warId, 'recon', 'war-iron-second-identity').ok, 'one roster member cannot attack twice under new action IDs');
  assert(!warService.resolveWar('iron-owner', challenge.warId, 'war-resolve-early').ok, 'leadership cannot resolve while attack slots and time remain');
  const violetRecon = warService.submitWarAttack('violet-owner', challenge.warId, 'recon', 'war-violet-recon');
  const ironRecon = warService.submitWarAttack('iron-admin', challenge.warId, 'recon', 'war-iron-recon');
  const violetAssault = warService.submitWarAttack('violet-admin', challenge.warId, 'assault', 'war-violet-assault');
  assert(violetRecon.ok && ironRecon.ok && violetAssault.ok, 'both communities can deploy distinct permitted roster members');
  assert(new Set(warService.getWar(challenge.warId).attackIds).size === 4, 'all generated attack IDs are unique and persisted');
  assert(!warService.submitWarAttack('iron-member', challenge.warId, 'assault', 'war-iron-over-cap').ok, 'community attack cap is enforced at two deployments');
  assert(warService.getWars('iron-admin')[0].id === warService.getWars('violet-owner')[0].id, 'both communities see the same service-owned active war after identity switching');
  const resolved = warService.resolveWar('violet-owner', challenge.warId, 'war-resolve-once');
  assert(resolved.ok && resolved.state === 'resolved' && resolved.score['iron-pines'] === assault.score + ironRecon.score, 'war resolves once with deterministic score totals after both attack caps');
  assert(resolved.rewards.length === 4 && resolved.rewards.every(reward => reward.amount === WAR_RULES.localRewardParts && reward.ledgerId.startsWith(`war-reward:${challenge.warId}:`)), 'local preview Parts rewards use stable per-identity ledger IDs');
  assert(warService.snapshot('iron-owner').member.parts === ironStartParts + WAR_RULES.localRewardParts, 'war reward credits only local preview inventory');
  const repeatedResolve = warService.resolveWar('violet-owner', challenge.warId, 'war-resolve-once');
  assert(repeatedResolve.ok && repeatedResolve.replay && warService.state.warRewardLedger.length === 4, 'same resolve action replays without a second reward ledger credit');
  assert(!warService.resolveWar('iron-owner', challenge.warId, 'war-resolve-again').ok && warService.state.warRewardLedger.length === 4, 'a different action cannot resolve or reward an already resolved war');
  const persistedWarService = new LocalGameService({ storage: warStorage, now: () => warClock });
  const persistedWar = persistedWarService.getWar(challenge.warId);
  assert(persistedWar.state === 'resolved' && persistedWar.replay.attackIds.length === 4 && persistedWarService.state.warRewardLedger.length === 4, 'refresh/reload preserves the replay, score, resolution and once-only reward ledger');
  checks.push('tactical scoring, attack roster/caps, duplicate IDs, cross-community shared state, deterministic resolution, local rewards and reload');

  const v2SourceService = new LocalGameService({ storage: new MemoryStorage(), now: () => warClock });
  v2SourceService.state.currentIdentityId = 'iron-admin';
  v2SourceService.state.members['iron-owner'].parts = 1234;
  v2SourceService.state.communities['iron-pines'].base.levels = { hq: 4, workshop: 3, tower: 2, comms: 3 };
  v2SourceService.state.communities['iron-pines'].base.treasury = 789;
  v2SourceService.state.schemaVersion = 2;
  const v2Raw = JSON.stringify(v2SourceService.state);
  const v2MigrationStorage = new MemoryStorage({ [V2_STORAGE_KEY]: v2Raw });
  const v2Migrated = new LocalGameService({ storage: v2MigrationStorage, now: () => warClock });
  assert(v2MigrationStorage.getItem(V2_BACKUP_KEY) === v2Raw && v2MigrationStorage.getItem(V2_STORAGE_KEY) === v2Raw, 'V2 migration preserves the exact raw save in a versioned backup without overwriting V2');
  assert(v2Migrated.state.schemaVersion === 3 && v2Migrated.snapshot('iron-owner').member.parts === 1234 && v2Migrated.snapshot('iron-owner').base.levels.hq === 4 && v2Migrated.snapshot('iron-owner').base.treasury === 789, 'V2-to-V3 migration keeps balances and building levels without grants or loss');
  const v2MigratedAgain = new LocalGameService({ storage: v2MigrationStorage, now: () => warClock });
  assert(v2MigratedAgain.snapshot('iron-owner').member.parts === 1234 && v2MigratedAgain.snapshot('iron-owner').base.levels.hq === 4, 'reloading the V3 save never repeats V2 migration or starter grants');
  checks.push('V2-to-V3 exact raw backup, no-loss migration, refresh stability and preserved V1 migration behavior');

  return { passed: checks.length, checks };
}
