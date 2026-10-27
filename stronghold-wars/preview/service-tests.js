import { GAME_CONFIG, LocalGameService, CORRUPT_BACKUP_PREFIX, LEGACY_BACKUP_KEY, LEGACY_STORAGE_KEY, SERVICE_STORAGE_KEY, V2_BACKUP_KEY, V2_STORAGE_KEY, WAR_RULES, WAR_STAGE_DEFS, BATTLE_WEAR_RULES } from './game-service.js';
import { buildingScaffoldState, reconcileBuildingSnapshot } from './game-runtime-state.js';
import { squadBattleStats, squadProfile, squadUnlocked, evaluateWarSquad } from './squad-assets.js';
import { DEFENDER_CONCEPTS, defenderBattleEffect } from './defender-assets.js';
import { OPERATIVES, OperationsController, EXPEDITION_RULES, EXPEDITION_FIELD, expeditionFieldPath, expeditionFieldWalkable } from './operative-ops.js';
import { createPatrolMotion, patrolNodesForLayout, setPatrolOrder, stepPatrolMotion } from './patrol-routes.js';
import { evaluateWarPlan, evaluateWarDefenceOrder, buildWarDamageReport, simulateWarCombat, normalizeWarCondition, warConditionAfter } from './war-tactics.js';

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
  assert(result.ok && result.accepted === 400 && result.constructionStarted && !result.completed, 'final donation assigns a builder crew');
  assert(service.snapshot('iron-owner').base.levels.hq === 1 && service.snapshot('iron-owner').base.projects.find(project => project.id === hallProjectId).status === 'constructing', 'Hall remains at its old level while the builder works');
  assert(service.processConstructionJobs('iron-owner').length === 0, 'builder does not finish before the deadline');
  clock += GAME_CONFIG.constructionSecondsPerLevel * 2 * 1000;
  assert(service.processConstructionJobs('iron-owner').join(',') === 'hq', 'Hall completes at its construction deadline');
  assert(service.snapshot('iron-owner').base.levels.hq === 2, 'Hall advances exactly once on full funding');
  assert(service.snapshot('iron-member').base.levels.hq === 2, 'two members observe the same shared base');
  assert(service.snapshot('iron-owner').member.lifetimeContributed === 0, 'leadership allocation is not counted as a personal contribution');
  assert(service.snapshot('iron-member').member.lifetimeContributed === 200, 'personal contribution lifetime total is recorded');
  assert(service.getChronicle('iron-member').entries.some(item => item.id === `project:${hallProjectId}` && item.at === clock), 'completed Hall project enters the shared Chronicle with its real completion time');
  assert(!service.getChronicle('iron-unverified').ok && service.getChronicle('violet-owner').entries.length === 0, 'Chronicle access is verified and scoped to one community');
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
  assert(result.ok && result.constructionStarted && service.snapshot('iron-owner').base.levels.workshop === 1, 'personal donation starts a partially treasury-funded project');
  clock += GAME_CONFIG.constructionSecondsPerLevel * 2 * 1000;
  assert(service.processConstructionJobs('iron-owner').join(',') === 'workshop' && service.snapshot('iron-owner').base.levels.workshop === 2, 'Workshop advances exactly once after construction');
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
  assert(treasuryFinish.ok && treasuryFinish.accepted === 170 && treasuryFinish.constructionStarted, 'allocation is capped to remaining project cost and starts construction');
  clock += GAME_CONFIG.constructionSecondsPerLevel * 2 * 1000;
  assert(service.processConstructionJobs('iron-owner').join(',') === 'tower', 'treasury-funded tower completes after its timer');
  const towerLevel = service.snapshot('iron-owner').base.levels.tower;
  const towerTreasury = service.snapshot('iron-owner').base.treasury;
  const replayAllocation = service.allocateTreasury('iron-admin', tower.projectId, 500, 'test-tower-treasury-final');
  assert(replayAllocation.replay && service.snapshot('iron-owner').base.levels.tower === towerLevel && service.snapshot('iron-owner').base.treasury === towerTreasury, 'replayed treasury allocation cannot pay or complete twice');
  assert(!service.allocateTreasury('iron-admin', tower.projectId, 1, 'test-tower-after-completion').ok, 'completed project rejects a second treasury allocation');
  assert(service.snapshot('iron-owner').base.treasury === 130, 'treasury allocation never makes the shared balance negative and keeps the unspent remainder');
  checks.push('treasury allocation, balance conservation, role restrictions and one-time completion');

  let builderClock = 1_910_000_000_000;
  const builderStorage = new MemoryStorage();
  let builderService = new LocalGameService({ storage: builderStorage, now: () => builderClock });
  builderService.community('iron-owner').saved.base.levels.hq = 2;
  const firstBuild = builderService.approveProject('iron-owner', 'workshop', 'builder-first');
  const secondBuild = builderService.approveProject('iron-owner', 'tower', 'builder-second');
  assert(firstBuild.ok && secondBuild.ok && builderService.getBuilderCapacity('iron-owner') === 1, 'Hall Level 2 grants one builder crew');
  assert(builderService.contributeToProject('iron-owner', firstBuild.projectId, 250, 'builder-fund-first').constructionStarted, 'first funded project starts');
  assert(builderService.contributeToProject('iron-owner', secondBuild.projectId, 250, 'builder-fund-second').constructionStarted, 'second funded project enters the crew queue');
  const builderProjects = builderService.snapshot('iron-owner').base.projects;
  const queued = builderProjects.find(project => project.id === secondBuild.projectId);
  assert(queued.startedAt === builderProjects.find(project => project.id === firstBuild.projectId).finishAt && queued.crewSlot === 0, 'one crew schedules projects without overlapping work');
  assert(!buildingScaffoldState({ projects: builderProjects, now: builderClock }).tower, 'queued work has no active scaffold before its start');
  builderClock += 40_000;
  builderService = new LocalGameService({ storage: builderStorage, now: () => builderClock });
  assert(builderService.snapshot('iron-owner').base.levels.workshop === 2 && builderService.snapshot('iron-owner').base.levels.tower === 1, 'refresh completes only the first due upgrade');
  assert(buildingScaffoldState({ projects: builderService.snapshot('iron-owner').base.projects, now: builderClock }).tower, 'queued upgrade reveals its scaffold when the crew becomes free');
  builderClock += 40_000;
  builderService = new LocalGameService({ storage: builderStorage, now: () => builderClock });
  assert(builderService.snapshot('iron-owner').base.levels.tower === 2 && builderService.processConstructionJobs('iron-owner').length === 0, 'offline completion runs once after refresh');
  builderService.community('iron-owner').saved.base.levels.hq = 3;
  builderService.member('iron-owner').parts = 1500;
  const parallelA = builderService.approveProject('iron-owner', 'workshop', 'builder-parallel-a');
  const parallelB = builderService.approveProject('iron-owner', 'tower', 'builder-parallel-b');
  assert(builderService.getBuilderCapacity('iron-owner') === 2 && parallelA.ok && parallelB.ok, 'Hall Level 3 grants two crews');
  builderService.contributeToProject('iron-owner', parallelA.projectId, 700, 'builder-parallel-fund-a');
  builderService.contributeToProject('iron-owner', parallelB.projectId, 700, 'builder-parallel-fund-b');
  const parallelProjects = builderService.snapshot('iron-owner').base.projects.filter(project => [parallelA.projectId, parallelB.projectId].includes(project.id));
  assert(parallelProjects[0].startedAt === parallelProjects[1].startedAt && parallelProjects[0].crewSlot !== parallelProjects[1].crewSlot, 'two crews work in parallel');
  builderClock += 60_000;
  assert(builderService.processConstructionJobs('iron-owner').length === 2, 'parallel upgrades complete at the same deadline');
  checks.push('builder capacity, queued and parallel construction, scaffold timing, offline completion and reload safety');

  let districtClock = 1_920_000_000_000;
  const districtStorage = new MemoryStorage();
  let districtService = new LocalGameService({ storage: districtStorage, now: () => districtClock });
  const districtBase = districtService.community('iron-owner').saved.base;
  districtBase.levels.hq = 2;
  const districtPlot = districtBase.landPlots.find(plot => plot.id === 'timberline-depot');
  districtPlot.status = 'claimed'; districtPlot.treesRemaining = 0; districtPlot.timberFunded = 60;
  districtService.member('iron-owner').parts = 1000;
  districtService.member('iron-owner').timber = 200;
  districtService.save();
  const districtCore = districtService.approveProject('iron-owner', 'workshop', 'district-core');
  assert(districtCore.ok && districtService.approveFacility('iron-owner', 'timberline-depot', 'district-facility').ok && districtService.approveRoute('iron-owner', 'timberline-depot', 'district-route').ok, 'owner approves core, facility and route upgrades on the same base');
  assert(districtService.contributeToProject('iron-owner', districtCore.projectId, 250, 'district-core-fund').constructionStarted, 'core upgrade takes the first crew slot');
  assert(districtService.contributeFacility('iron-owner', 'timberline-depot', 100, 30, 'district-facility-fund').constructionStarted, 'fully funded facility enters the shared queue');
  assert(districtService.contributeRoute('iron-owner', 'timberline-depot', 65, 30, 'district-route-fund').constructionStarted, 'fully funded route enters the shared queue');
  const scheduled = districtService.snapshot('iron-owner').base;
  const coreJob = scheduled.projects.find(project => project.id === districtCore.projectId);
  const facilityJob = scheduled.landPlots[1].facilityProject;
  const routeJob = scheduled.landPlots[1].routeProject;
  assert(facilityJob.crewSlot === 0 && routeJob.crewSlot === 0 && facilityJob.startedAt === coreJob.finishAt && routeJob.startedAt === facilityJob.finishAt, 'one builder crew serializes all three project types');
  assert(scheduled.landPlots[1].facilityLevel === 0 && scheduled.landPlots[1].routeLevel === 0 && districtService.routeNetworkBonus('iron-owner') === 0, 'queued district upgrades grant no early building or resource bonus');
  districtClock = coreJob.finishAt;
  districtService = new LocalGameService({ storage: districtStorage, now: () => districtClock });
  assert(districtService.snapshot('iron-owner').base.levels.workshop === 2 && districtService.snapshot('iron-owner').base.landPlots[1].facilityLevel === 0, 'refresh completes core work and leaves the facility active');
  districtClock = facilityJob.finishAt;
  districtService = new LocalGameService({ storage: districtStorage, now: () => districtClock });
  assert(districtService.snapshot('iron-owner').base.landPlots[1].facilityLevel === 1 && districtService.snapshot('iron-owner').base.landPlots[1].routeLevel === 0, 'refresh completes the facility and leaves the route active');
  districtClock = routeJob.finishAt;
  districtService = new LocalGameService({ storage: districtStorage, now: () => districtClock });
  assert(districtService.snapshot('iron-owner').base.landPlots[1].routeLevel === 1 && districtService.routeNetworkBonus('iron-owner') === 5 && districtService.processConstructionJobs('iron-owner').length === 0, 'route bonus begins once at its saved deadline');
  checks.push('shared core and district builder queue, delayed benefits and one-time offline completion');

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

  const patrolStorage = new MemoryStorage();
  let patrolService = new LocalGameService({ storage: patrolStorage, now: () => clock });
  assert(patrolService.snapshot('iron-owner').base.patrolOrders.assault === 'standard', 'older and fresh bases use the original role route by default');
  assert(!patrolService.assignPatrolOrder('iron-member', 'assault', 'tower', 'patrol-member').ok && !patrolService.assignPatrolOrder('iron-unverified', 'assault', 'tower', 'patrol-unverified').ok && !patrolService.assignPatrolOrder('free-owner', 'assault', 'tower', 'patrol-free').ok, 'only eligible verified leadership can change patrols');
  assert(!patrolService.assignPatrolOrder('iron-owner', 'sentinel', 'tower', 'patrol-locked').ok, 'a locked squad cannot be assigned a route');
  assert(!patrolService.assignPatrolOrder('iron-owner', 'assault', 'invalid', 'patrol-invalid').ok, 'unknown destinations are rejected');
  const routeOrder = patrolService.assignPatrolOrder('iron-owner', 'assault', 'tower', 'patrol-tower');
  assert(routeOrder.ok && patrolService.snapshot('iron-member').base.patrolOrders.assault === 'tower' && patrolService.snapshot('violet-owner').base.patrolOrders.assault === 'standard', 'owner order is shared with connected members and isolated from rival bases');
  assert(patrolService.assignPatrolOrder('iron-owner', 'assault', 'tower', 'patrol-tower').replay && !patrolService.assignPatrolOrder('iron-owner', 'assault', 'camp', 'patrol-tower').ok, 'order action IDs replay only the same order');
  const motion = setPatrolOrder(createPatrolMotion('assault'), 'tower');
  const layout = patrolService.snapshot('iron-owner').base.layout;
  const nodes = patrolNodesForLayout(layout);
  let reachedTower = false;
  for (let i = 0; i < 500; i++) {
    stepPatrolMotion(motion, 0.1, nodes, layout);
    if (motion.node === 'tower') { reachedTower = true; break; }
  }
  assert(reachedTower, 'the assigned soldier walks from camp to the selected building');
  setPatrolOrder(motion, 'camp');
  let returnedToCamp = false;
  for (let i = 0; i < 500; i++) {
    stepPatrolMotion(motion, 0.1, nodes, layout);
    if (motion.node === 'camp') { returnedToCamp = true; break; }
  }
  assert(returnedToCamp, 'a new hold order turns the same soldier back toward camp');
  patrolService = new LocalGameService({ storage: patrolStorage, now: () => clock });
  assert(patrolService.snapshot('iron-admin').base.patrolOrders.assault === 'tower', 'patrol orders survive reload without resetting the shared base');
  checks.push('leadership patrol assignments, access and unlock gates, replay safety, obstacle-aware movement and reload');

  let defenderClock = clock + 12_000;
  const defenderStorage = new MemoryStorage();
  let defenderService = new LocalGameService({ storage: defenderStorage, now: () => defenderClock });
  assert(Object.keys(defenderService.snapshot('iron-owner').base.defenders).length === 4 && Object.values(defenderService.snapshot('iron-owner').base.defenders).every(unit => unit.level === 0 && unit.post === null), 'four defender classes start locked and unassigned');
  assert(!defenderService.approveDefender('iron-owner', 'guardian', 'defender-early').ok, 'defender unlock waits for Hall and specialist progress');
  for (const id of ['iron-pines', 'violet-ridge']) defenderService.state.communities[id].base.levels = { hq: 3, workshop: 3, tower: 3, comms: 3 };
  assert(!defenderService.approveDefender('iron-member', 'guardian', 'defender-member-approval').ok && !defenderService.approveDefender('iron-unverified', 'guardian', 'defender-unverified-approval').ok && !defenderService.approveDefender('free-owner', 'guardian', 'defender-free-approval').ok, 'only eligible verified leadership approves shared defenders');
  const guardianApproval = defenderService.approveDefender('iron-owner', 'guardian', 'defender-guardian-approval');
  assert(guardianApproval.ok && guardianApproval.targetLevel === 1 && !defenderService.approveDefender('iron-owner', 'guardian', 'defender-duplicate-approval').ok, 'one owner-approved defender project opens at a time');
  assert(defenderService.approveDefender('iron-owner', 'guardian', 'defender-guardian-approval').replay, 'approval action replay cannot open another project');
  const guardianPartial = defenderService.fundDefender('iron-member', 'guardian', 80, 'defender-guardian-partial');
  assert(guardianPartial.ok && guardianPartial.accepted === 80 && !guardianPartial.completed, 'verified member funds an approved defender from personal Parts');
  const afterPartial = defenderService.snapshot('iron-member').member.parts;
  assert(defenderService.fundDefender('iron-member', 'guardian', 80, 'defender-guardian-partial').replay && defenderService.snapshot('iron-member').member.parts === afterPartial, 'funding action replay never double debits');
  assert(!defenderService.fundDefender('iron-unverified', 'guardian', 10, 'defender-unverified-fund').ok && !defenderService.fundDefender('free-owner', 'guardian', 10, 'defender-free-fund').ok, 'unverified and Free identities cannot fund the defender');
  const guardianFinish = defenderService.fundDefender('iron-admin', 'guardian', 100, 'defender-guardian-complete');
  assert(guardianFinish.ok && guardianFinish.completed && guardianFinish.level === 1 && defenderService.snapshot('iron-owner').base.defenders.guardian.project === null, 'exact funding completes the shared tier once');
  assert(!defenderService.fundDefender('iron-admin', 'guardian', 1, 'defender-guardian-after-complete').ok && !defenderService.assignDefender('iron-member', 'guardian', 'gate', 'defender-member-assign').ok, 'completed funding closes and members cannot assign posts');
  assert(defenderService.assignDefender('iron-owner', 'guardian', 'gate', 'defender-guardian-assign').ok && !defenderService.assignDefender('iron-owner', 'guardian', 'invalid', 'defender-bad-post').ok, 'leadership assigns an unlocked unit only to a real defensive post');
  assert(defenderService.getWorldMap().find(item => item.id === 'iron-pines').defenders.guardian.post === 'gate' && defenderService.getWorldMap().find(item => item.id === 'violet-ridge').defenders.guardian.level === 0, 'public defender posts are scoped by community');
  defenderService = new LocalGameService({ storage: defenderStorage, now: () => defenderClock });
  assert(defenderService.snapshot('iron-owner').base.defenders.guardian.level === 1 && defenderService.snapshot('iron-member').base.defenders.guardian.post === 'gate' && defenderService.getChronicle('iron-member').entries.some(item => item.id === 'defender:guardian:1'), 'defender level, post and milestone survive reload for the community');
  const effects = defenderBattleEffect({ guardian: { level: 5, post: 'gate' }, aegis: { level: 4, post: 'comms' }, trapper: { level: 3, post: 'tower' }, hound: { level: 3, post: 'hall' } }, 'assault');
  assert(effects.scorePenalty === 14 && effects.exposureShield === 3 && effects.casualtyPressure === 1 && defenderBattleEffect({ guardian: { level: 5, post: null } }, 'assault').scorePenalty === 0, 'distinct assigned units have bounded effects and reserve units have none');
  assert(defenderBattleEffect({ guardian: { level: 5, post: 'gate' }, aegis: { level: 4, post: 'comms' }, trapper: { level: 3, post: 'tower' } }, 'recon').scorePenalty === 11, 'Aegis intercepts Recon while Guardian is Assault-specific');
  assert(Object.keys(DEFENDER_CONCEPTS).length === 4, 'every owner-supplied defender concept has a playable rule');
  const defenderWar = defenderService.challengeWar('violet-owner', 'iron-pines', 'defender-war-challenge');
  assert(defenderWar.ok && defenderService.acceptWarChallenge('iron-owner', defenderWar.warId, 'defender-war-accept').ok, 'eligible communities can freeze assigned defenders into a war');
  assert(defenderService.getWar(defenderWar.warId).snapshots.defender.base.defenders.guardian.post === 'gate', 'accepted war records the assigned Guardian');
  assert(defenderService.assignDefender('iron-owner', 'guardian', null, 'defender-stand-down-after-snapshot').ok && defenderService.getWar(defenderWar.warId).snapshots.defender.base.defenders.guardian.post === 'gate', 'later owner reassignment does not change frozen war defences');
  defenderClock += WAR_RULES.preparationReadyMs;
  assert(defenderService.startWar('iron-owner', defenderWar.warId, 'defender-war-start').ok, 'war starts after preparation');
  const defendedAttack = defenderService.submitWarAttack('violet-owner', defenderWar.warId, 'assault', 'defender-war-assault');
  assert(defendedAttack.ok && defendedAttack.defenderPenalty === 2 && defendedAttack.feedback.includes('assigned defenders -2'), 'assigned Guardian affects the frozen Assault result even after being stood down at home');
  assert(new LocalGameService({ storage: defenderStorage, now: () => defenderClock }).getWar(defenderWar.warId).attacks[0].defenderPenalty === 2, 'defender battle result survives reload');
  checks.push('four defenders: Pro and leadership gates, shared funding, replay, post assignment, frozen war effects and reload');

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

  const facilityStorage = new MemoryStorage();
  let facilityService = new LocalGameService({ storage: facilityStorage, now: () => clock });
  facilityService.community('iron-owner').saved.base.levels.hq = 2;
  assert(!facilityService.approveFacility('iron-owner', 'timberline-depot', 'facility-before-land').ok, 'facility cannot begin before its land is claimed');
  for (let i = 0; i < 3; i++) assert(facilityService.chopTree('iron-member', 'timberline-depot', `facility-chop-${i}`).ok, 'member clears facility site');
  assert(facilityService.approveLandClaim('iron-owner', 'timberline-depot', 'facility-land-approve').ok, 'owner approves facility land');
  assert(facilityService.contributeTimber('iron-member', 'timberline-depot', 60, 'facility-land-fund').status === 'claimed', 'member funds shared facility land');
  assert(!facilityService.approveFacility('iron-member', 'timberline-depot', 'facility-member-approve').ok, 'member cannot approve major infrastructure');
  assert(!facilityService.approveFacility('iron-unverified', 'timberline-depot', 'facility-unverified-approve').ok, 'unverified identity cannot approve infrastructure');
  assert(facilityService.approveFacility('iron-owner', 'timberline-depot', 'facility-owner-approve').ok, 'owner opens a shared facility project');
  assert(!facilityService.contributeFacility('iron-unverified', 'timberline-depot', 10, 10, 'facility-unverified-fund').ok, 'unverified identity cannot fund a facility');
  assert(!facilityService.contributeFacility('iron-member', 'timberline-depot', -1, 10, 'facility-negative').ok, 'negative contribution is rejected');
  const partialFacility = facilityService.contributeFacility('iron-member', 'timberline-depot', 50, 15, 'facility-partial');
  assert(partialFacility.ok && !partialFacility.completed && partialFacility.acceptedParts === 50 && partialFacility.acceptedTimber === 15, 'member can partially fund both facility resources');
  const partialBalance = facilityService.snapshot('iron-member').member;
  assert(facilityService.contributeFacility('iron-member', 'timberline-depot', 50, 15, 'facility-partial').replay && facilityService.member('iron-member').parts === partialBalance.parts && facilityService.member('iron-member').timber === partialBalance.timber, 'facility donation replay does not debit resources twice');
  assert(!facilityService.contributeFacility('iron-member', 'ridgewatch-range', 10, 0, 'facility-partial').ok, 'same action ID cannot replay against another plot');
  const finalFacility = facilityService.contributeFacility('iron-member', 'timberline-depot', 50, 15, 'facility-final');
  assert(finalFacility.ok && finalFacility.constructionStarted && finalFacility.facilityLevel === 0, 'final community donation assigns a crew without granting the facility early');
  assert(!facilityService.contributeFacility('iron-owner', 'timberline-depot', 50, 15, 'facility-after-complete').ok, 'constructing facility project closes to further funding');
  assert(facilityService.processConstructionJobs('iron-owner').length === 0, 'facility remains unfinished before its deadline');
  clock += GAME_CONFIG.constructionSecondsPerLevel * 1000;
  facilityService = new LocalGameService({ storage: facilityStorage, now: () => clock });
  assert(facilityService.snapshot('iron-member').base.landPlots[1].facilityLevel === 1 && facilityService.processConstructionJobs('iron-owner').length === 0, 'offline facility completion runs once at the saved deadline');
  assert(facilityService.claimDepotTimber('iron-member').amount === 20, 'Level 1 Lumber Yard grants daily personal Timber');
  assert(!facilityService.claimDepotTimber('iron-member').ok, 'daily Lumber Yard cannot be claimed again immediately');
  facilityService = new LocalGameService({ storage: facilityStorage, now: () => clock });
  assert(facilityService.snapshot('iron-member').base.landPlots[1].facilityLevel === 1 && !facilityService.claimDepotTimber('iron-member').ok, 'facility tier and member cooldown survive reload');
  assert(facilityService.approveFacility('iron-admin', 'timberline-depot', 'facility-level-two').targetLevel === 2, 'admin may approve next tier under Hall gate');
  assert(facilityService.snapshot('iron-owner').base.landPlots[1].facilityProject.partsCost === 250, 'Level 2 facility costs persist as approved infrastructure');
  const recycled = facilityService.recycleTimber('iron-member', 'facility-recycle-once');
  assert(recycled.ok && recycled.amount === GAME_CONFIG.recycledTimber && recycled.cost === GAME_CONFIG.recycleSalvageCost, 'Salvage creates a renewable Timber route after all trees are gone');
  const recycledBalance = facilityService.snapshot('iron-member').member;
  assert(facilityService.recycleTimber('iron-member', 'facility-recycle-once').replay && facilityService.member('iron-member').timber === recycledBalance.timber && facilityService.member('iron-member').salvage === recycledBalance.salvage, 'recycling replay cannot grant Timber twice');
  assert(!facilityService.recycleTimber('iron-unverified', 'facility-recycle-locked').ok, 'unverified identity cannot use the renewable route');
  checks.push('district construction, approval roles, entitlement gates, one-time completion, daily and recycled Timber, reload');

  let yardClock = 1_900_050_000_000;
  const yardStorage = new MemoryStorage();
  let yardService = new LocalGameService({ storage: yardStorage, now: () => yardClock });
  const yardPlot = yardService.community('iron-owner').saved.base.landPlots.find(plot => plot.id === 'timberline-depot');
  yardPlot.status = 'claimed'; yardPlot.treesRemaining = 0; yardPlot.timberFunded = 60; yardPlot.facilityLevel = 1;
  yardService.save();
  assert(yardService.getTimberProductionInfo('iron-member').capacity === 30 && yardService.getTimberProductionInfo('iron-member').perMinute === 2, 'Level 1 Lumber Yard has a separate two Timber per minute collector and 30 Timber stock cap');
  assert(!yardService.collectYardTimber('iron-unverified').ok && !yardService.collectYardTimber('free-owner').ok, 'unverified and Free preview identities cannot collect Yard stock');
  yardClock += 30 * 60_000;
  yardService = new LocalGameService({ storage: yardStorage, now: () => yardClock });
  assert(yardService.member('iron-member').timberStored === 30 && yardService.member('iron-owner').timberStored === 30, 'offline Yard production fills each verified member stock only to its level cap');
  yardService = new LocalGameService({ storage: yardStorage, now: () => yardClock });
  assert(yardService.member('iron-member').timberStored === 30, 'reload at the same timestamp cannot mint Yard stock twice');
  assert(yardService.collectYardTimber('iron-member').amount === 30 && yardService.member('iron-member').timberStored === 0, 'collection transfers only produced Timber to the member balance');
  assert(!yardService.collectYardTimber('iron-member').ok && yardService.member('iron-owner').timberStored === 30, 'repeat collection cannot duplicate stock and another member keeps their own stock');
  yardService.setOwnerProActive('iron-owner', false);
  yardClock += 10 * 60_000;
  yardService = new LocalGameService({ storage: yardStorage, now: () => yardClock });
  assert(yardService.member('iron-member').timberStored === 0 && yardService.getTimberProductionInfo('iron-member').perMinute === 0, 'inactive simulated Pro pauses Yard production without erasing stock');
  yardService.setOwnerProActive('iron-owner', true);
  yardService.community('iron-owner').saved.base.landPlots.find(plot => plot.id === 'timberline-depot').facilityLevel = 2;
  yardClock += 30_000;
  assert(yardService.collectYardTimber('iron-member').amount === 2 && yardService.getTimberProductionInfo('iron-member').capacity === 50, 'Level 2 Yard produces four Timber per minute and increases storage');
  const oldYardSave = JSON.parse(yardStorage.getItem(SERVICE_STORAGE_KEY));
  delete oldYardSave.members['iron-member'].timberProductionAt;
  const oldYardStorage = new MemoryStorage({ [SERVICE_STORAGE_KEY]: JSON.stringify(oldYardSave) });
  yardClock += 60 * 60_000;
  const oldYardReload = new LocalGameService({ storage: oldYardStorage, now: () => yardClock });
  assert(oldYardReload.member('iron-member').timberStored === 0 && oldYardReload.member('iron-member').timberProductionAt === yardClock, 'older saves start the Yard clock now without a retroactive Timber grant');
  checks.push('separate Lumber Yard production, tiered storage, exact offline collection, Pro pause, member isolation and old-save clock');

  const routeStorage = new MemoryStorage();
  let routeService = new LocalGameService({ storage: routeStorage, now: () => clock });
  routeService.community('iron-owner').saved.base.levels.hq = 2;
  assert(!routeService.approveRoute('iron-owner', 'timberline-depot', 'route-before-claim').ok, 'a supply route cannot be approved before its district is claimed');
  for (let i = 0; i < 3; i++) assert(routeService.chopTree('iron-member', 'timberline-depot', `route-chop-${i}`).ok, 'member clears the future route district');
  assert(routeService.approveLandClaim('iron-owner', 'timberline-depot', 'route-claim-approve').ok, 'owner approves route district land');
  assert(routeService.contributeTimber('iron-member', 'timberline-depot', 60, 'route-claim-fund').status === 'claimed', 'member completes the land claim');
  assert(!routeService.approveRoute('iron-member', 'timberline-depot', 'route-member-approve').ok, 'members cannot approve main route infrastructure');
  assert(!routeService.approveRoute('free-owner', 'timberline-depot', 'route-free-approve').ok, 'Free community cannot approve route infrastructure');
  assert(routeService.approveRoute('iron-owner', 'timberline-depot', 'route-owner-approve').targetLevel === 1, 'owner approves the first shared route tier');
  assert(routeService.setOwnerProActive('iron-owner', false).ok && !routeService.contributeRoute('iron-member', 'timberline-depot', 10, 10, 'route-inactive-pro').ok, 'inactive owner Pro locks member construction');
  assert(routeService.setOwnerProActive('iron-owner', true).ok, 'reactivating owner Pro restores the preserved route project');
  assert(!routeService.contributeRoute('iron-unverified', 'timberline-depot', 10, 10, 'route-unverified').ok, 'unverified member cannot fund a supply route');
  assert(!routeService.contributeRoute('iron-member', 'timberline-depot', -1, 10, 'route-negative').ok, 'negative route donation is rejected');
  const partialRoute = routeService.contributeRoute('iron-member', 'timberline-depot', 20, 10, 'route-partial');
  assert(partialRoute.ok && !partialRoute.completed && partialRoute.acceptedParts === 20 && partialRoute.acceptedTimber === 10, 'member funds a route with both personal resources');
  const routeBalance = routeService.snapshot('iron-member').member;
  assert(routeService.contributeRoute('iron-member', 'timberline-depot', 20, 10, 'route-partial').replay && routeService.member('iron-member').parts === routeBalance.parts && routeService.member('iron-member').timber === routeBalance.timber, 'replayed route donation cannot debit twice');
  assert(!routeService.contributeRoute('iron-admin', 'timberline-depot', 20, 10, 'route-partial').ok, 'another identity cannot borrow a route action ID');
  const builtRoute = routeService.contributeRoute('iron-member', 'timberline-depot', 25, 10, 'route-complete');
  assert(builtRoute.ok && builtRoute.constructionStarted && builtRoute.routeLevel === 0 && routeService.routeNetworkBonus('iron-owner') === 0, 'route funding assigns a crew without granting its bonus early');
  clock += GAME_CONFIG.constructionSecondsPerLevel * 1000;
  routeService = new LocalGameService({ storage: routeStorage, now: () => clock });
  assert(routeService.routeNetworkBonus('iron-owner') === 5 && routeService.processConstructionJobs('iron-owner').length === 0, 'shared Level 1 route grants its bonus once after offline completion');
  assert(routeService.getChronicle('iron-member').entries.some(item => item.id === 'land:timberline-depot') && routeService.getChronicle('iron-member').entries.some(item => item.id === 'route:timberline-depot:1'), 'completed land and supply route enter the community Chronicle');
  assert(routeService.routeNetworkBonus('violet-owner') === 0 && !routeService.contributeRoute('iron-member', 'timberline-depot', 1, 1, 'route-after-complete').ok, 'other communities cannot borrow routes and completed projects close');
  routeService = new LocalGameService({ storage: routeStorage, now: () => clock });
  assert(routeService.snapshot('iron-owner').base.landPlots[1].routeLevel === 1 && routeService.routeNetworkBonus('iron-member') === 5, 'route level and bonus survive reload');
  assert(routeService.approveRoute('iron-admin', 'timberline-depot', 'route-level-two').targetLevel === 2, 'admin can approve the next Hall-gated route tier');
  assert(routeService.snapshot('iron-owner').base.landPlots[1].routeProject.partsCost === 100, 'approved route project persists at its fixed costs');
  assert(routeService.recycleTimber('iron-member', 'route-recycle').ok, 'finite forest can supply further route levels through recycling');
  assert(routeService.contributeRoute('iron-member', 'timberline-depot', 100, 35, 'route-level-two-fund').constructionStarted, 'member funds Level 2 route with recycled Timber');
  clock += GAME_CONFIG.constructionSecondsPerLevel * 2 * 1000;
  assert(routeService.processConstructionJobs('iron-owner').includes('route:timberline-depot') && routeService.routeNetworkBonus('iron-owner') === 10, 'Level 2 route bonus begins after its construction deadline');
  assert(!routeService.approveRoute('iron-owner', 'timberline-depot', 'route-level-three-locked').ok, 'Hall Level 2 cannot approve route Level 3');
  assert(routeService.claimDailySalvage('iron-member').amount === 110 && !routeService.claimDailySalvage('iron-member').ok, 'route tiers add to a once-daily personal claim without repeat grants');
  assert(routeService.claimDailySalvage('violet-member').amount === GAME_CONFIG.dailySalvage, 'another community keeps its unmodified local daily claim');
  checks.push('DZN supply routes: owner approval, member funding, exact replay, persistence, community bonus and daily claim cap');

  let bonusClock = clock;
  const bonusService = new LocalGameService({ storage: new MemoryStorage(), now: () => bonusClock });
  for (const id of ['iron-pines', 'violet-ridge']) bonusService.state.communities[id].base.levels = { hq: 5, workshop: 2, tower: 2, comms: 2 };
  const ironPlots = bonusService.state.communities['iron-pines'].base.landPlots;
  const violetPlots = bonusService.state.communities['violet-ridge'].base.landPlots;
  for (const [plotId, level] of [['ridgewatch-range', 2], ['signal-marsh', 3]]) { const plot = ironPlots.find(item => item.id === plotId); plot.status = 'claimed'; plot.facilityLevel = level; }
  const violetWorks = violetPlots.find(item => item.id === 'highland-works'); violetWorks.status = 'claimed'; violetWorks.facilityLevel = 2;
  const bonusChallenge = bonusService.challengeWar('iron-owner', 'violet-ridge', 'bonus-challenge');
  assert(bonusChallenge.ok && bonusService.acceptWarChallenge('violet-owner', bonusChallenge.warId, 'bonus-accept').ok, 'both qualified communities can lock upgraded facilities into a war');
  const bonusWar = bonusService.getWar(bonusChallenge.warId);
  assert(bonusWar.snapshots.challenger.stats.assaultBonus === 4 && bonusWar.snapshots.challenger.stats.reconBonus === 6 && bonusWar.snapshots.defender.stats.worksDefence === 4, 'facility battle bonuses are frozen in both war snapshots');
  ironPlots.find(item => item.id === 'ridgewatch-range').facilityLevel = 5;
  violetWorks.facilityLevel = 5;
  assert(bonusService.getWar(bonusChallenge.warId).snapshots.challenger.stats.assaultBonus === 4 && bonusService.getWar(bonusChallenge.warId).snapshots.defender.stats.worksDefence === 4, 'later upgrades cannot change an accepted war');
  bonusClock += WAR_RULES.preparationReadyMs;
  assert(bonusService.startWar('iron-owner', bonusChallenge.warId, 'bonus-start').ok, 'facility war enters active window');
  const bonusAssault = bonusService.submitWarAttack('iron-owner', bonusChallenge.warId, 'assault', 'bonus-assault');
  const expectedBonusScore = Math.max(0, Math.min(100, Math.round(20 + 5 * 12 + 2 * 16 + 2 * 4 - 5 * 4 - 2 * 10 + 4 - 4)));
  assert(bonusAssault.ok && bonusAssault.score === expectedBonusScore, 'assault applies frozen Range bonus and Works defence exactly once');
  checks.push('four district battle stats, immutable war snapshots and deterministic facility scoring');

  let eliteClock = clock;
  const eliteService = new LocalGameService({ storage: new MemoryStorage(), now: () => eliteClock });
  for (const id of ['iron-pines', 'violet-ridge']) eliteService.state.communities[id].base.levels = { hq: 4, workshop: 3, tower: 3, comms: 3 };
  const eliteChallenge = eliteService.challengeWar('iron-owner', 'violet-ridge', 'elite-challenge');
  assert(eliteChallenge.ok && eliteService.acceptWarChallenge('violet-owner', eliteChallenge.warId, 'elite-accept').ok, 'upgraded communities can lock specialist squads into a war');
  const eliteWar = eliteService.getWar(eliteChallenge.warId);
  const eliteKit = eliteWar.snapshots.challenger.stats.assaultKit;
  assert(squadUnlocked('sentinel', eliteWar.snapshots.challenger.base.levels) && squadUnlocked('medic', eliteWar.snapshots.challenger.base.levels), 'Hall 4 and specialist Level 3 unlock heavy and medical roles');
  assert(eliteKit.reinforcementRole === 'sentinel' && eliteKit.supportRole === 'medic' && eliteKit.scoreBonus > 0 && eliteKit.casualtyShield > 0, 'specialist weapon and medical buffs are captured in the pre-war snapshot');
  eliteService.state.communities['iron-pines'].base.levels = { hq: 5, workshop: 5, tower: 5, comms: 5 };
  eliteService.save();
  const reloadedElite = new LocalGameService({ storage: eliteService.storage, now: () => eliteClock });
  assert(reloadedElite.getWar(eliteChallenge.warId).snapshots.challenger.stats.assaultKit.scoreBonus === eliteKit.scoreBonus, 'save reload preserves frozen kit bonuses despite later base upgrades');
  eliteClock += WAR_RULES.preparationReadyMs;
  assert(reloadedElite.startWar('iron-owner', eliteChallenge.warId, 'elite-start').ok, 'upgraded war begins after preparation');
  const eliteAttack = reloadedElite.submitWarAttack('iron-owner', eliteChallenge.warId, 'assault', 'elite-attack');
  const baseEliteScore = 20 + 4 * 12 + 3 * 16 + 3 * 4 - 4 * 4 - 3 * 10;
  const baseEliteLosses = 4 + 3 - Math.floor(3 / 2) + 1;
  assert(eliteAttack.ok && eliteAttack.score === Math.min(100, baseEliteScore + eliteKit.scoreBonus) && eliteAttack.casualties === Math.max(0, baseEliteLosses - eliteKit.casualtyShield), 'frozen weapon damage adds points while health, armour and Lifeline prevent losses exactly once');
  assert(squadProfile('sentinel', { hq: 5, tower: 5 }).maxHealth > squadProfile('sentinel', { hq: 4, tower: 3 }).maxHealth && squadBattleStats({ hq: 3, tower: 2, workshop: 2 }).reinforcementRole === '', 'kit progression improves health and keeps advanced roles locked below their gates');
  checks.push('five-role unit unlocks, frozen upgraded combat stats, saved-war reload and casualty mitigation');

  const trainingService = new LocalGameService({ storage: new MemoryStorage(), now: () => clock });
  const initialTraining = trainingService.getTrainingLoadout('iron-owner');
  assert(initialTraining.capacity === 4 && initialTraining.counts.assault === 4, 'older and fresh saves have a valid Warden training squad');
  const mixedTraining = { assault: 2, recon: 1, engineer: 1, sentinel: 0, medic: 0 };
  assert(trainingService.setTrainingLoadout('iron-owner', mixedTraining).ok, 'verified owner can save a mixed unlocked training squad');
  assert(!trainingService.setTrainingLoadout('iron-owner', { ...mixedTraining, sentinel: 1 }).ok, 'locked Sentinel cannot enter a training squad');
  assert(!trainingService.setTrainingLoadout('iron-owner', { ...mixedTraining, assault: 3 }).ok, 'training capacity cannot be exceeded');
  assert(!trainingService.setTrainingLoadout('iron-owner', { ...mixedTraining, recon: 0.5 }).ok, 'fractional troop counts are rejected');
  assert(!trainingService.setTrainingLoadout('iron-unverified', mixedTraining).ok && !trainingService.setTrainingLoadout('free-owner', mixedTraining).ok, 'unverified and Free preview identities cannot configure training');
  const reloadedTraining = new LocalGameService({ storage: trainingService.storage, now: () => clock });
  assert(reloadedTraining.getTrainingLoadout('iron-owner').counts.recon === 1 && reloadedTraining.getTrainingLoadout('iron-owner').counts.engineer === 1, 'saved mixed squad survives reload');
  assert(reloadedTraining.getTrainingLoadout('iron-member').counts.assault === 4, 'another connected member has an independent loadout');
  trainingService.state.communities['iron-pines'].base.levels = { hq: 4, workshop: 3, tower: 3, comms: 3 };
  assert(trainingService.setTrainingLoadout('iron-owner', { assault: 3, recon: 1, engineer: 1, sentinel: 2, medic: 1 }).ok, 'advanced squad roles unlock through Hall and specialist buildings');
  checks.push('member-specific training loadouts, capacity and role gates, Pro access and save reload');
  assert(trainingService.setTrainingLoadout('iron-owner', { assault: 4 }).ok, 'owner can ready the starter Warden unit for a drill');
  const trainingStartParts = trainingService.snapshot('iron-owner').member.parts;
  assert(!trainingService.recordTrainingVictory('iron-owner', 1, 300).ok, 'an unrecorded training encounter cannot claim a reward');
  assert(trainingService.recordTrainingAttempt(1).ok, 'a training attempt is recorded before the encounter');
  result = trainingService.recordTrainingVictory('iron-owner', 1, 300);
  assert(result.ok && result.reward === 300, 'training victory reward is applied through the local service');
  const afterTrainingReward = trainingService.snapshot('iron-owner').member.parts;
  assert(afterTrainingReward === trainingStartParts + 300, 'training reward credits the current member inventory');
  assert(!trainingService.recordTrainingVictory('iron-owner', 1, 300).ok && trainingService.snapshot('iron-owner').member.parts === afterTrainingReward, 'repeated raid victory cannot claim twice');
  checks.push('recorded AI training attempt, member reward and duplicate-victory protection');

  let campClock = 1_900_000_000_000;
  const campStorage = new MemoryStorage();
  let campService = new LocalGameService({ storage: campStorage, now: () => campClock });
  assert(campService.getTrainingReadiness('iron-owner').ready && campService.getTrainingReadiness('iron-owner').reserve.assault === 4, 'fresh camp starts with a usable four-Warden squad');
  assert(!campService.trainTroops('free-owner', 'assault', 1, 'camp-free').ok && !campService.trainTroops('iron-unverified', 'assault', 1, 'camp-unverified').ok, 'training uses the Pro and verified-member gates');
  assert(!campService.trainTroops('iron-owner', 'sentinel', 1, 'camp-locked').ok && !campService.trainTroops('iron-owner', 'assault', 0, 'camp-zero').ok, 'locked and invalid troop orders are rejected');
  const firstOrder = campService.trainTroops('iron-owner', 'assault', 2, 'camp-first');
  assert(firstOrder.ok && firstOrder.cost === 60 && campService.member('iron-owner').parts === 540, 'camp debits personal Parts once at queue time');
  assert(campService.trainTroops('iron-owner', 'assault', 2, 'camp-first').replay && campService.member('iron-owner').parts === 540, 'replayed training action cannot debit again');
  assert(!campService.trainTroops('iron-owner', 'assault', 3, 'camp-overflow').ok, 'ready plus queued troops cannot exceed camp storage');
  assert(campService.recordTrainingAttempt(1, 'iron-owner').ok && campService.getTrainingReadiness('iron-owner').reserve.assault === 0, 'drill consumes exactly the selected ready squad');
  assert(campService.recordTrainingAttempt(1, 'iron-owner').replay && campService.getTrainingReadiness('iron-owner').reserve.assault === 0, 'replayed drill cannot consume a second squad');
  assert(!campService.recordTrainingAttempt(2, 'iron-owner').ok, 'a second drill waits for trained replacements');
  campService = new LocalGameService({ storage: campStorage, now: () => campClock });
  assert(campService.getTrainingReadiness('iron-owner').reserve.assault === 0 && campService.getTrainingReadiness('iron-owner').jobs.length === 1, 'camp reserve and queue survive reload without free troops');
  campClock = firstOrder.finishAt + 1;
  assert(campService.getTrainingReadiness('iron-owner').reserve.assault === 2 && campService.getTrainingReadiness('iron-owner').jobs.length === 0, 'offline training completes once at its deadline');
  assert(!campService.getTrainingReadiness('iron-owner').ready && campService.trainTroops('iron-owner', 'assault', 2, 'camp-second').ok, 'camp reports a partial squad and allows replenishment');
  campClock = campService.member('iron-owner').trainingJobs[0].finishAt + 1;
  assert(campService.getTrainingReadiness('iron-owner').ready && campService.getTrainingReadiness('iron-owner').reserve.assault === 4, 'replenished squad becomes deployable at the expected time');
  checks.push('personal camp training queue, Parts debit, offline completion, capacity, access and one-time drill deployment');

  let reinforcementClock = 1_900_025_000_000;
  const reinforcementStorage = new MemoryStorage();
  let reinforcementService = new LocalGameService({ storage: reinforcementStorage, now: () => reinforcementClock });
  assert(!reinforcementService.requestReinforcements('iron-unverified', 'assault', 1, 'reinforce-unverified').ok
    && !reinforcementService.requestReinforcements('free-owner', 'assault', 1, 'reinforce-free').ok
    && !reinforcementService.requestReinforcements('iron-owner', 'sentinel', 1, 'reinforce-locked').ok,
  'community troop requests require verified Pro access and an unlocked role');
  const troopRequest = reinforcementService.requestReinforcements('iron-owner', 'assault', 2, 'reinforce-request-1');
  assert(troopRequest.ok && reinforcementService.requestReinforcements('iron-owner', 'assault', 2, 'reinforce-request-1').replay
    && !reinforcementService.requestReinforcements('iron-owner', 'assault', 1, 'reinforce-request-2').ok,
  'one active request per member is posted and replayed without duplication');
  assert(!reinforcementService.donateReinforcements('iron-owner', troopRequest.requestId, 1, 'reinforce-self').ok
    && !reinforcementService.donateReinforcements('violet-owner', troopRequest.requestId, 1, 'reinforce-foreign').ok
    && !reinforcementService.donateReinforcements('iron-unverified', troopRequest.requestId, 1, 'reinforce-guest').ok,
  'own, foreign-community and unverified donations are rejected');
  const firstReinforcement = reinforcementService.donateReinforcements('iron-admin', troopRequest.requestId, 1, 'reinforce-donation-1');
  assert(firstReinforcement.ok && firstReinforcement.remaining === 1
    && reinforcementService.member('iron-admin').trainingReserve.assault === 3
    && reinforcementService.member('iron-owner').trainingReserve.assault === 5,
  'donation conserves one trained troop between camp reserves');
  assert(reinforcementService.donateReinforcements('iron-admin', troopRequest.requestId, 1, 'reinforce-donation-1').replay
    && reinforcementService.member('iron-owner').trainingReserve.assault === 5,
  'replayed donation cannot duplicate a reinforcement');
  reinforcementService = new LocalGameService({ storage: reinforcementStorage, now: () => reinforcementClock });
  assert(reinforcementService.getReinforcementRequests('iron-member').requests[0].remaining === 1
    && reinforcementService.member('iron-owner').trainingReserve.assault === 5,
  'the shared request and recipient reserve survive reload');
  reinforcementService.setOwnerProActive('iron-owner', false);
  assert(!reinforcementService.donateReinforcements('iron-member', troopRequest.requestId, 1, 'reinforce-paused').ok,
    'owner Pro pause blocks camp donations');
  reinforcementService.setOwnerProActive('iron-owner', true);
  assert(reinforcementService.donateReinforcements('iron-member', troopRequest.requestId, 1, 'reinforce-donation-2').remaining === 0
    && !reinforcementService.donateReinforcements('iron-member', troopRequest.requestId, 1, 'reinforce-overfill').ok,
  'remaining troop fills the request once and a closed request rejects more');
  const expiringRequest = reinforcementService.requestReinforcements('iron-owner', 'assault', 1, 'reinforce-expiring');
  reinforcementClock = expiringRequest.expiresAt;
  assert(reinforcementService.getReinforcementRequests('iron-owner').requests.length === 0
    && !reinforcementService.donateReinforcements('iron-admin', expiringRequest.requestId, 1, 'reinforce-too-late').ok,
  'unfilled requests expire without moving troops');
  reinforcementService.member('iron-owner').trainingReserve.assault = 8;
  assert(!reinforcementService.requestReinforcements('iron-owner', 'assault', 1, 'reinforce-no-room').ok,
    'full receiving camp cannot request troops it cannot hold');
  checks.push('community reinforcement requests, troop conservation, expiry, access, camp capacity and replay');

  let orderClock = 1_900_000_000_000;
  const orderStorage = new MemoryStorage();
  let orderService = new LocalGameService({ storage: orderStorage, now: () => orderClock });
  assert(orderService.getFieldOrders('iron-owner').orders.every(order => !order.completed), 'fresh Field Orders start without earned progress');
  assert(!orderService.getFieldOrders('iron-unverified').ok && !orderService.claimFieldOrder('free-owner', 'parts').ok, 'Field Orders obey member verification and owner Pro gates');
  assert(!orderService.claimFieldOrder('iron-owner', 'parts').ok && !orderService.claimFieldOrder('iron-owner', 'unknown').ok, 'unearned and unknown orders cannot be claimed');
  orderService.setMemberValue('iron-owner', 'stored', 3);
  assert(orderService.collectParts('iron-owner').amount === 3, 'collecting real produced Parts completes its Field Order');
  assert(orderService.getFieldOrders('iron-owner').orders.find(order => order.id === 'parts').completed, 'supply pickup completion appears on the board');
  const orderParts = orderService.snapshot('iron-owner').member.parts;
  assert(orderService.claimFieldOrder('iron-owner', 'parts').amount === 40, 'supply order pays the stated personal Parts');
  assert(!orderService.claimFieldOrder('iron-owner', 'parts').ok && orderService.snapshot('iron-owner').member.parts === orderParts + 40, 'repeat claim cannot pay twice');
  assert(!orderService.getFieldOrders('iron-member').orders.find(order => order.id === 'parts').completed, 'another member has independent Field Orders');
  const orderForge = orderService.startForgeJob('iron-owner', 'field-parts', 'field-order-forge-start');
  assert(orderForge.ok, 'owner starts a real Forge job for the order');
  orderClock += 16_000;
  assert(orderService.claimForgeJob('iron-owner', orderForge.jobId).ok, 'claiming completed Forge output earns its Field Order');
  assert(orderService.claimFieldOrder('iron-owner', 'forge').amount === 50, 'Forge order pays once');
  assert(orderService.recordTrainingAttempt(1).ok && orderService.recordTrainingVictory('iron-owner', 1, 300).ok, 'a real training victory earns its Field Order');
  assert(orderService.claimFieldOrder('iron-owner', 'drill').amount === 60, 'drill order pays once');
  orderService = new LocalGameService({ storage: orderStorage, now: () => orderClock });
  assert(orderService.getFieldOrders('iron-owner').orders.every(order => order.claimed), 'all three claims survive a save reload');
  orderClock += 24 * 60 * 60 * 1000;
  assert(orderService.getFieldOrders('iron-owner').orders.every(order => !order.completed && !order.claimed), 'Field Orders reset at the next UTC day');
  assert(!orderService.claimFieldOrder('iron-owner', 'drill').ok, 'yesterday’s completed drill cannot pay today');
  checks.push('daily Field Orders from real actions, access gates, independent rewards, reload and UTC rollover');

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

  let productionClock = 1_900_100_000_000;
  const productionStorage = new MemoryStorage();
  let productionService = new LocalGameService({ storage: productionStorage, now: () => productionClock });
  assert(productionService.getProductionInfo('iron-owner').capacity === 500 && productionService.getProductionInfo('iron-owner').perSecond === 2, 'Level 1 Workshop starts with 500 Parts storage at two Parts per second');
  productionClock += 10_000;
  productionService = new LocalGameService({ storage: productionStorage, now: () => productionClock });
  assert(productionService.snapshot('iron-owner').member.stored === 20, 'Workshop production catches up after ten seconds away');
  productionService = new LocalGameService({ storage: productionStorage, now: () => productionClock });
  assert(productionService.snapshot('iron-owner').member.stored === 20, 'reloading at the same time cannot mint Parts twice');
  productionClock += 10_000;
  assert(productionService.collectParts('iron-owner').amount === 40 && productionService.snapshot('iron-owner').member.stored === 0, 'collection includes unclaimed offline production once');
  productionService.state.communities['iron-pines'].base.levels.workshop = 2;
  productionService.save();
  productionClock += 600_000;
  productionService = new LocalGameService({ storage: productionStorage, now: () => productionClock });
  assert(productionService.getProductionInfo('iron-owner').capacity === 750 && productionService.snapshot('iron-owner').member.stored === 750, 'upgraded Workshop production stops at its larger storage cap');
  assert(productionService.setOwnerProActive('iron-owner', false).ok, 'owner can pause the local Pro preview');
  productionClock += 60_000;
  productionService = new LocalGameService({ storage: productionStorage, now: () => productionClock });
  assert(productionService.snapshot('iron-owner').member.stored === 750 && productionService.getProductionInfo('iron-owner').perSecond === 0, 'inactive owner Pro does not produce Parts while away');
  assert(productionService.setOwnerProActive('iron-owner', true).ok && productionService.collectParts('iron-owner').amount === 750, 'restoring Pro keeps stored Parts without backfilling locked time');
  productionClock += 10_000;
  assert(productionService.collectParts('iron-owner').amount === 40, 'upgraded Workshop resumes at the new rate after Pro is active');
  const oldProductionSave = JSON.parse(productionStorage.getItem(SERVICE_STORAGE_KEY));
  delete oldProductionSave.members['iron-owner'].productionAt;
  const oldProductionStorage = new MemoryStorage({ [SERVICE_STORAGE_KEY]: JSON.stringify(oldProductionSave) });
  productionClock += 100_000;
  const oldProductionReload = new LocalGameService({ storage: oldProductionStorage, now: () => productionClock });
  assert(oldProductionReload.snapshot('iron-owner').member.stored === 0 && oldProductionReload.snapshot('iron-owner').member.productionAt === productionClock, 'old saves start their clock now without an invented offline grant');
  checks.push('offline Workshop production, tiered storage, exact refresh and claim, Pro pause and safe old-save migration');

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
  // The war fixture has real built districts so attacks can leave visible, repairable wear.
  warService.state.communities['violet-ridge'].base.landPlots.find(plot => plot.id === 'timberline-depot').facilityLevel = 1;
  const violetRidgewatch = warService.state.communities['violet-ridge'].base.landPlots.find(plot => plot.id === 'ridgewatch-range');
  Object.assign(violetRidgewatch, { status: 'claimed', treesRemaining: 0, facilityLevel: 1 });
  const ironTimberline = warService.state.communities['iron-pines'].base.landPlots.find(plot => plot.id === 'timberline-depot');
  Object.assign(ironTimberline, { status: 'claimed', treesRemaining: 0, facilityLevel: 1 });
  warService.save();
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
  assert(!warService.setWarDefenceOrder('violet-member', challenge.warId, 'signals', 'defence-member').ok
    && !warService.setWarDefenceOrder('free-owner', challenge.warId, 'signals', 'defence-free').ok
    && !warService.setWarDefenceOrder('violet-owner', challenge.warId, '__proto__', 'defence-invalid').ok,
    'only participating eligible leadership can assign a defined defence order');
  const signalOrder = warService.setWarDefenceOrder('violet-owner', challenge.warId, 'signals', 'defence-violet-signals');
  const reserveOrder = warService.setWarDefenceOrder('iron-owner', challenge.warId, 'reserve', 'defence-iron-reserve');
  assert(signalOrder.ok && reserveOrder.ok && warService.setWarDefenceOrder('violet-owner', challenge.warId, 'battery', 'defence-violet-signals').replay,
    'defence orders are idempotent, and a repeated action cannot silently change a choice');
  assert(new LocalGameService({ storage: warStorage, now: () => warClock }).getWar(challenge.warId).defenceOrders['violet-ridge'].order === 'signals',
    'both preparation orders survive a browser reload');
  assert(!warService.startWar('violet-owner', challenge.warId, 'war-start-too-early').ok, 'war cannot start before the preparation countdown');
  warClock += WAR_RULES.preparationReadyMs;
  const started = warService.startWar('violet-admin', challenge.warId, 'war-start-once');
  assert(started.ok && started.state === 'active' && started.attackEndsAt === warClock + WAR_RULES.attackWindowMs, 'an opposing owner/admin starts a bounded attack window after preparation');
  assert(!warService.setWarDefenceOrder('violet-owner', challenge.warId, 'battery', 'defence-after-start').ok
    && warService.getWar(challenge.warId).defenceOrders['violet-ridge'].order === 'signals', 'war launch locks both sides’ preparation orders');
  const perimeterEffect = evaluateWarDefenceOrder('perimeter', 'assault', { method: 'breach', objective: 'hq' });
  const batteryEffect = evaluateWarDefenceOrder('battery', 'assault', { method: 'flank', objective: 'tower' });
  const signalEffect = evaluateWarDefenceOrder('signals', 'recon', { method: 'flank', objective: 'comms' });
  const reserveEffect = evaluateWarDefenceOrder('reserve', 'assault', null, 2);
  assert(perimeterEffect.scorePenalty === 4 && batteryEffect.scorePenalty === 5 && signalEffect.casualtyPressure === 1
    && reserveEffect.exposureShield === 6 && !evaluateWarDefenceOrder('reserve', 'assault', null, 0).active
    && !evaluateWarDefenceOrder('perimeter', 'assault', { method: 'flank', objective: 'hq' }).active,
    'specialist defences counter only their chosen threat and home reserve protects an exposed base');
  checks.push('challenge inbox lifecycle, opposing acceptance, immutable snapshots, prep timer and attack-window start');

  const lockedWar = warService.getWar(challenge.warId);
  const corridorFixture = JSON.parse(JSON.stringify(lockedWar.snapshots.defender));
  corridorFixture.base.layout.structures.hq = { x: 0, z: 0 };
  corridorFixture.base.layout.walls = [{ id: 'wall-1', x: -10, z: 0, level: 3 }];
  const breachPlan = evaluateWarPlan(corridorFixture, 'assault', { lane: 'west', objective: 'hq', method: 'breach' });
  const flankPlan = evaluateWarPlan(corridorFixture, 'assault', { lane: 'west', objective: 'hq', method: 'flank' });
  const clearLane = evaluateWarPlan(corridorFixture, 'assault', { lane: 'south', objective: 'hq', method: 'breach' });
  assert(breachPlan.ok && breachPlan.wallPressure === 3 && breachPlan.breachedWallIds[0] === 'wall-1' && breachPlan.route.length === 4, 'a locked placed wall appears on the west assault corridor and supplies a breach waypoint');
  assert(flankPlan.ok && flankPlan.breachedWallIds.length === 0 && flankPlan.casualtyDelta < breachPlan.casualtyDelta && clearLane.wallPressure === 0, 'flanking avoids the cut and another lane avoids the placed wall');
  assert(!evaluateWarPlan(corridorFixture, 'assault', { lane: 'teleport', objective: 'hq', method: 'breach' }).ok, 'unknown tactical routes cannot be submitted');
  const advancedLevels = { hq: 4, tower: 3, workshop: 3, comms: 3 };
  const baseArmy = evaluateWarSquad(advancedLevels, 'assault', { assault: 10 }, 10, breachPlan);
  const specialistArmy = evaluateWarSquad(advancedLevels, 'assault', { assault: 3, recon: 1, engineer: 2, sentinel: 2, medic: 2 }, 10, breachPlan);
  assert(baseArmy.ok && specialistArmy.ok && specialistArmy.specialties.some(text => text.includes('Fixer breach')) && specialistArmy.specialties.some(text => text.includes('Lifeline recovery')) && specialistArmy.casualtyDelta < baseArmy.casualtyDelta, 'a full unlocked mixed army gives route-specific Fixer support and medic recovery');
  assert(squadBattleStats(advancedLevels, 'assault', baseArmy.counts).reinforcementRole === ''
    && squadBattleStats(advancedLevels, 'assault', baseArmy.counts).supportRole === ''
    && squadBattleStats(advancedLevels, 'assault', specialistArmy.counts).reinforcementRole === 'sentinel'
    && squadBattleStats(advancedLevels, 'assault', specialistArmy.counts).supportRole === 'medic', 'unselected specialists cannot grant hidden Sentinel or Lifeline kit bonuses');
  assert(!evaluateWarSquad(advancedLevels, 'assault', { assault: 9 }, 10, breachPlan).ok
    && !evaluateWarSquad(advancedLevels, 'assault', { assault: 11 }, 10, breachPlan).ok
    && !evaluateWarSquad(advancedLevels, 'assault', { assault: 9, medic: 0.5 }, 10, breachPlan).ok
    && !evaluateWarSquad(advancedLevels, 'assault', { assault: 0, medic: 10 }, 10, breachPlan).ok
    && !evaluateWarSquad(advancedLevels, 'recon', { assault: 10 }, 10, breachPlan).ok, 'war roster requires exact capacity, whole counts and the tactic’s lead soldier');
  const combatAttacker = JSON.parse(JSON.stringify(lockedWar.snapshots.challenger));
  combatAttacker.base.levels = advancedLevels;
  combatAttacker.stats.squadSize = 10;
  const combatInput = { tactic: 'assault', tactics: breachPlan, squad: specialistArmy, combatBaseScore: 45, defenderPenalty: 0, defenceOrderPenalty: 0, orders: [] };
  const cutCombat = simulateWarCombat(combatAttacker, corridorFixture, combatInput);
  const flankCombat = simulateWarCombat(combatAttacker, corridorFixture, { ...combatInput, tactics: flankPlan });
  assert(cutCombat.ok && cutCombat.version === 2 && cutCombat.walls.length === 1 && flankCombat.walls.length === 0
    && JSON.stringify(cutCombat) === JSON.stringify(simulateWarCombat(combatAttacker, corridorFixture, combatInput))
    && cutCombat.squad.filter(unit => unit.withdrawn).length === cutCombat.casualties,
  'accepted snapshots and a selected route resolve the same troop losses, wall health and score every time');
  assert(cutCombat.squad.every(unit => unit.remainingHealth >= 0 && unit.remainingHealth <= unit.maxHealth
    && unit.hits.reduce((total, hit) => total + hit.damage, unit.remainingHealth) === unit.maxHealth)
    && [...cutCombat.walls, cutCombat.objective].every(target => target.remainingHealth >= 0 && target.remainingHealth <= target.maxHealth
      && target.hits.reduce((total, hit) => total + hit.damage, target.remainingHealth) === target.maxHealth),
  'individual incoming and outgoing hits account for every bounded health change, including medic recovery');
  assert(flankCombat.objective.hits.filter(hit => hit.at < 0.6).reduce((sum, hit) => sum + hit.damage, 0)
    > cutCombat.objective.hits.filter(hit => hit.at < 0.6).reduce((sum, hit) => sum + hit.damage, 0),
    'a standing wall absorbs the early volleys that a clear flank puts into the selected building');
  const fortifiedCombat = JSON.parse(JSON.stringify(corridorFixture));
  fortifiedCombat.base.levels.tower = 5;
  const hardCombat = simulateWarCombat(combatAttacker, fortifiedCombat, combatInput);
  assert(hardCombat.casualties >= cutCombat.casualties && hardCombat.score <= cutCombat.score,
    'a stronger Arc Battery causes at least as much attrition and cannot improve the attacker score');
  const focusCombat = simulateWarCombat(combatAttacker, corridorFixture, { ...combatInput,
    orders: [{ phase: 'contact', command: 'focus' }, { phase: 'withdrawal', command: 'pursue' }] });
  const coveredCombat = simulateWarCombat(combatAttacker, corridorFixture, { ...combatInput,
    orders: [{ phase: 'contact', command: 'smoke' }, { phase: 'withdrawal', command: 'cover' }] });
  assert(focusCombat.objective.remainingHealth <= coveredCombat.objective.remainingHealth
    && coveredCombat.casualties <= focusCombat.casualties,
  'focus and pursuit push objective damage while smoke and cover protect the deployed squad');
  const priorCondition = normalizeWarCondition(corridorFixture, { objectives: { hq: 100, tower: -40 }, walls: { 'wall-1': 0, invented: 0 } });
  const followPlan = evaluateWarPlan(corridorFixture, 'assault', { lane: 'west', objective: 'hq', method: 'breach' }, priorCondition);
  const followCombat = simulateWarCombat(combatAttacker, corridorFixture, { ...combatInput, tactics: followPlan, conditionAtLaunch: priorCondition });
  assert(priorCondition.objectives.tower === 0 && !Object.hasOwn(priorCondition.walls, 'invented')
    && followPlan.wallCount === 0 && followCombat.objective.startingHealth === 100 && followCombat.walls.length === 0
    && followCombat.objective.remainingHealth <= 100
    && followCombat.score === Math.max(0, Math.min(100, Math.round(45 + (100 - followCombat.objective.remainingHealth) / followCombat.objective.maxHealth * 19 - followCombat.casualties * 2)))
    && followCombat.objective.hits.reduce((sum, hit) => sum + hit.damage, followCombat.objective.remainingHealth) === 100,
  'a second strike sees a previous wall breach and only the target health remaining at launch');
  const carryForward = warConditionAfter(corridorFixture, [{ damage: cutCombat }, { damage: followCombat }]);
  assert(carryForward.objectives.hq === Math.min(cutCombat.objective.remainingHealth, followCombat.objective.remainingHealth)
    && carryForward.walls['wall-1'] === cutCombat.walls[0].remainingHealth
    && JSON.stringify(followCombat) === JSON.stringify(simulateWarCombat(combatAttacker, corridorFixture, { ...combatInput, tactics: followPlan, conditionAtLaunch: priorCondition })),
  'cumulative fortification condition and a launched strike replay deterministically');
  checks.push('persistent war objective and wall condition, fresh-damage scoring, bounded snapshot and deterministic replay');
  const carryStorage = new MemoryStorage({ [SERVICE_STORAGE_KEY]: warStorage.getItem(SERVICE_STORAGE_KEY) });
  const carryService = new LocalGameService({ storage: carryStorage, now: () => warClock });
  const carryCapacity = lockedWar.snapshots.challenger.stats.squadSize;
  carryService.member('iron-owner').trainingReserve.assault = carryCapacity;
  carryService.member('iron-admin').trainingReserve.assault = carryCapacity;
  carryService.save();
  const carryPlan = { lane: 'west', objective: 'tower', method: 'flank', squad: { assault: carryCapacity } };
  const firstStrike = carryService.submitWarAttack('iron-owner', challenge.warId, 'assault', 'carry-first', carryPlan);
  const secondStrike = carryService.submitWarAttack('iron-admin', challenge.warId, 'assault', 'carry-second', carryPlan);
  assert(firstStrike.ok && secondStrike.ok && secondStrike.damage.objective.startingHealth === firstStrike.damage.objective.remainingHealth
    && carryService.getWarCondition(challenge.warId, 'violet-ridge').objectives.tower === secondStrike.damage.objective.remainingHealth,
  'two distinct roster members attack the same weakened building without resetting its health');
  const laterFirstOrder = carryService.issueWarFieldOrder('iron-owner', challenge.warId, firstStrike.attackId, 'contact', 'focus', 'carry-later-order');
  assert(laterFirstOrder.ok && JSON.stringify(carryService.getWar(challenge.warId).attacks[1].damage) === JSON.stringify(secondStrike.damage),
  'a delayed order on the first strike does not retroactively change the second strike');
  const persistedCarry = new LocalGameService({ storage: carryStorage, now: () => warClock }).getWar(challenge.warId).attacks;
  assert(JSON.stringify(persistedCarry[1].damage) === JSON.stringify(secondStrike.damage)
    && persistedCarry[1].conditionAtLaunch.objectives.tower === firstStrike.damage.objective.remainingHealth,
  'the second strike keeps its launch condition and exact hit report across a browser reload');
  checks.push('shared-war consecutive strikes, frozen carry-over and save reload');
  checks.push('snapshot-driven spatial combat, wall absorption, upgraded turret attrition, medic healing and field-order tradeoffs');
  const attackerStats = lockedWar.snapshots.challenger.base.levels;
  const defenderStats = lockedWar.snapshots.defender.base.levels;
  const expectedAssault = Math.max(0, Math.min(100, Math.round(20 + attackerStats.hq * 12 + attackerStats.tower * 16 + attackerStats.comms * 4 - defenderStats.hq * 4 - defenderStats.tower * 10 - 3)));
  const ironStartParts = warService.snapshot('iron-owner').member.parts;
  const invalidPlan = { lane: 'west', objective: 'tower', method: 'flank' };
  assert(!warService.submitWarAttack('iron-owner', challenge.warId, 'assault', 'invalid-locked-sentinel', { ...invalidPlan, squad: { assault: 7, sentinel: 1 } }).ok
    && !warService.submitWarAttack('iron-owner', challenge.warId, 'assault', 'invalid-negative-army', { ...invalidPlan, squad: { assault: 9, recon: -1 } }).ok
    && warService.getWar(challenge.warId).attacks.length === 0, 'server-owned war action rejects locked and negative squads without consuming a deployment');
  const assault = warService.submitWarAttack('iron-owner', challenge.warId, 'assault', 'war-iron-assault');
  assert(assault.ok && assault.score === expectedAssault && assault.attackId && assault.feedback.includes('counterfire'), 'Assault score and visible defence feedback derive from locked snapshots');
  assert(assault.damage.ok && assault.damage.squad.length === lockedWar.snapshots.challenger.stats.squadSize
    && assault.damage.squad.filter(unit => unit.remainingHealth === 0).length === assault.casualties
    && assault.damage.squad.every(unit => unit.hits.reduce((sum, hit) => sum + hit.damage, unit.remainingHealth) === unit.maxHealth),
  'every committed troop has bounded, fully accounted health matching the locked casualty count');
  const breachDamage = buildWarDamageReport(lockedWar.snapshots.challenger, corridorFixture,
    { tactic: 'assault', score: 55, casualties: 1, tactics: breachPlan });
  assert(breachDamage.ok && breachDamage.walls.length === breachPlan.breachedWallIds.length
    && breachDamage.walls.every(wall => wall.hits.reduce((sum, hit) => sum + hit.damage, 0) === wall.maxHealth)
    && buildWarDamageReport(lockedWar.snapshots.challenger, corridorFixture,
      { tactic: 'assault', score: 55, casualties: 1, tactics: flankPlan }).walls.length === 0,
  'only selected breach walls lose their own tiered health; a flank does not invent wall damage');
  assert(JSON.stringify(breachDamage) === JSON.stringify(buildWarDamageReport(lockedWar.snapshots.challenger, corridorFixture,
    { tactic: 'assault', score: 55, casualties: 1, tactics: breachPlan }))
    && breachDamage.objective.remainingHealth > 0 && breachDamage.objective.remainingHealth < breachDamage.objective.maxHealth,
  'the frozen result produces the same bounded damage replay without destroying a permanent structure');
  assert(!warService.issueWarFieldOrder('violet-owner', challenge.warId, assault.attackId, 'contact', 'focus', 'foreign-order').ok, 'opposing roster members cannot command another squad');
  assert(!warService.issueWarFieldOrder('iron-owner', challenge.warId, assault.attackId, 'withdrawal', 'pursue', 'out-of-sequence').ok, 'withdrawal requires a contact order');
  assert(!warService.issueWarFieldOrder('iron-owner', challenge.warId, assault.attackId, 'contact', 'teleport', 'invalid-order').ok, 'unknown battle commands are rejected');
  const contactOrder = warService.issueWarFieldOrder('iron-owner', challenge.warId, assault.attackId, 'contact', 'smoke', 'contact-smoke');
  assert(contactOrder.ok && contactOrder.score === assault.score && contactOrder.casualties <= assault.casualties, 'smoke protects the squad without inflating an assault score');
  assert(contactOrder.damage.casualties === contactOrder.casualties && contactOrder.damage.squad.filter(unit => unit.remainingHealth === 0).length === contactOrder.casualties,
    'a field order updates the remaining troop health beats with its saved casualty result');
  assert(warService.issueWarFieldOrder('iron-owner', challenge.warId, assault.attackId, 'contact', 'focus', 'contact-smoke').replay, 'the same field-order action replays without changing its command');
  assert(!warService.issueWarFieldOrder('iron-owner', challenge.warId, assault.attackId, 'contact', 'focus', 'contact-again').ok, 'a second contact command cannot score twice');
  const withdrawalOrder = warService.issueWarFieldOrder('iron-owner', challenge.warId, assault.attackId, 'withdrawal', 'pursue', 'withdrawal-pursue');
  assert(withdrawalOrder.ok && withdrawalOrder.score === assault.score + 5 && withdrawalOrder.totalScore === assault.score + 5, 'pressing the target updates the shared war score once');
  const orderedReload = new LocalGameService({ storage: warStorage, now: () => warClock });
  const persistedAttack = orderedReload.getWar(challenge.warId).attacks.find(attack => attack.attackId === assault.attackId);
  assert(persistedAttack.orders.length === 2 && persistedAttack.score === withdrawalOrder.score && persistedAttack.casualties === withdrawalOrder.casualties, 'both battle orders and their adjusted outcome survive a save reload');
  assert(JSON.stringify(persistedAttack.damage) === JSON.stringify(withdrawalOrder.damage),
    'the damage report is regenerated from the saved attack and final field orders after reload');
  const duplicateAssault = warService.submitWarAttack('iron-owner', challenge.warId, 'recon', 'war-iron-assault');
  assert(duplicateAssault.ok && duplicateAssault.replay && duplicateAssault.attackId === assault.attackId && warService.getWar(challenge.warId).attacks.length === 1, 'a repeated action ID is replay-safe and cannot deploy a second attack');
  assert(!warService.submitWarAttack('iron-admin', challenge.warId, 'recon', 'war-iron-assault').ok, 'action IDs cannot be reused by another identity');
  assert(!warService.submitWarAttack('iron-owner', challenge.warId, 'recon', 'war-iron-second-identity').ok, 'one roster member cannot attack twice under new action IDs');
  assert(!warService.resolveWar('iron-owner', challenge.warId, 'war-resolve-early').ok, 'leadership cannot resolve while attack slots and time remain');
  const openHomeStorage = new MemoryStorage({ [SERVICE_STORAGE_KEY]: warStorage.getItem(SERVICE_STORAGE_KEY) });
  const openHomeService = new LocalGameService({ storage: openHomeStorage, now: () => warClock });
  openHomeService.state.wars.find(item => item.id === challenge.warId).defenceOrders['iron-pines'].order = 'balanced';
  const openHomeRecon = openHomeService.submitWarAttack('violet-owner', challenge.warId, 'recon', 'counterfactual-open-home');
  const violetRecon = warService.submitWarAttack('violet-owner', challenge.warId, 'recon', 'war-violet-recon');
  assert(openHomeRecon.ok && violetRecon.exposureBonus <= openHomeRecon.exposureBonus
    && openHomeRecon.exposureBonus - violetRecon.exposureBonus === Math.min(6, openHomeRecon.exposureBonus),
    'home reserve subtracts a bounded exposure advantage while the rival squad is away');
  const reconCapacity = lockedWar.snapshots.challenger.stats.squadSize;
  const ironReconPlan = { lane: 'south', objective: 'comms', method: 'flank', squad: { recon: reconCapacity - 2, engineer: 2 } };
  const untrainedAttack = warService.submitWarAttack('iron-admin', challenge.warId, 'recon', 'untrained-recon', ironReconPlan);
  assert(!untrainedAttack.ok && /Train/.test(untrainedAttack.error) && warService.getWar(challenge.warId).attacks.length === 2,
    'an untrained tactical roster cannot consume an attack or create free soldiers');
  warService.member('iron-admin').trainingReserve.recon = reconCapacity - 2;
  warService.member('iron-admin').trainingReserve.engineer = 2;
  warService.save();
  const unguardedRelayStorage = new MemoryStorage({ [SERVICE_STORAGE_KEY]: warStorage.getItem(SERVICE_STORAGE_KEY) });
  const unguardedRelay = new LocalGameService({ storage: unguardedRelayStorage, now: () => warClock });
  unguardedRelay.state.wars.find(item => item.id === challenge.warId).defenceOrders['violet-ridge'].order = 'balanced';
  const unguardedRecon = unguardedRelay.submitWarAttack('iron-admin', challenge.warId, 'recon', 'counterfactual-unguarded-relay', ironReconPlan);
  const ironRecon = warService.submitWarAttack('iron-admin', challenge.warId, 'recon', 'war-iron-recon', ironReconPlan);
  const violetAssault = warService.submitWarAttack('violet-admin', challenge.warId, 'assault', 'war-violet-assault');
  assert(violetRecon.ok && ironRecon.ok && violetAssault.ok, 'both communities can deploy distinct permitted roster members');
  assert(warService.getTrainingReadiness('iron-admin').reserve.recon === 0
    && warService.getTrainingReadiness('iron-admin').reserve.engineer === 0
    && warService.getTrainingReadiness('iron-admin').away.length === 1
    && !warService.trainTroops('iron-admin', 'assault', 5, 'overfilled-away-camp').ok,
  'a war deployment moves the exact trained roster into occupied away camp spaces');
  assert(ironRecon.tactics?.plan.lane === 'south' && ironRecon.tactics?.plan.objective === 'comms' && ironRecon.feedback.includes('tactical planning points') && ironRecon.squad?.counts.engineer === 2 && ironRecon.feedback.includes('composition planning points') && ironRecon.damage.version === 2,
    'a committed route, objective and chosen squad change the actual battle score and explanation');
  assert(ironRecon.defenceOrder === 'signals' && ironRecon.defenceOrderActive && ironRecon.defenceOrderPenalty === 4
    && ironRecon.feedback.includes('Protect the relay') && violetRecon.defenceOrder === 'reserve' && violetRecon.defenceOrderActive
    && violetRecon.defenceExposureShield === 6, 'locked defensive orders affect the appropriate incoming attacks and exposed home');
  assert(unguardedRecon.ok && unguardedRecon.score > ironRecon.score && ironRecon.casualties >= unguardedRecon.casualties,
    `a prepared relay defence reduces the same frozen route's score without improving attacker survival (${unguardedRecon.score}/${ironRecon.score} points, ${unguardedRecon.casualties}/${ironRecon.casualties} losses)`);
  const liveContact = warService.issueWarFieldOrder('iron-admin', challenge.warId, ironRecon.attackId, 'contact', 'focus', 'v2-contact');
  const liveWithdrawal = warService.issueWarFieldOrder('iron-admin', challenge.warId, ironRecon.attackId, 'withdrawal', 'cover', 'v2-withdrawal');
  assert(liveContact.ok && liveWithdrawal.ok && liveWithdrawal.damage.version === 2
    && liveWithdrawal.totalScore === withdrawalOrder.score + liveWithdrawal.score
    && liveWithdrawal.damage.score === liveWithdrawal.score && liveWithdrawal.damage.casualties === liveWithdrawal.casualties,
  'the live field commands rerun hit-based combat and commit only their score difference to the shared war');
  const v2Reload = new LocalGameService({ storage: warStorage, now: () => warClock }).getWar(challenge.warId);
  const reloadedV2 = v2Reload.attacks.find(attack => attack.attackId === ironRecon.attackId);
  assert(reloadedV2.combatVersion === 2 && reloadedV2.orders.length === 2 && reloadedV2.score === liveWithdrawal.score
    && JSON.stringify(reloadedV2.damage) === JSON.stringify(liveWithdrawal.damage),
  'a hit-based attack and its two field orders replay exactly after browser reload');
  const returnedStorage = new MemoryStorage({ [SERVICE_STORAGE_KEY]: warStorage.getItem(SERVICE_STORAGE_KEY) });
  const returnedService = new LocalGameService({ storage: returnedStorage, now: () => warClock + WAR_RULES.squadReturnMs + 1 });
  const returning = returnedService.getTrainingReadiness('iron-admin');
  assert(returning.away.length === 0
    && returning.reserve.recon === liveWithdrawal.damage.squad.filter(unit => unit.role === 'recon' && unit.remainingHealth > 0).length
    && returning.reserve.engineer === liveWithdrawal.damage.squad.filter(unit => unit.role === 'engineer' && unit.remainingHealth > 0).length,
  'after reload, only final field-order survivors return to the personal camp once');
  const settledReserve = JSON.stringify(returning.reserve);
  assert(JSON.stringify(new LocalGameService({ storage: returnedStorage, now: () => warClock + WAR_RULES.squadReturnMs + 2 }).getTrainingReadiness('iron-admin').reserve) === settledReserve,
    'a second reload cannot duplicate returned soldiers');
  checks.push('trained war rosters, away camp capacity, final casualty returns and one-time reload settlement');
  assert(warService.submitWarAttack('iron-admin', challenge.warId, 'recon', 'war-iron-recon', { lane: 'east', objective: 'hq', method: 'breach' }).replay && warService.getWar(challenge.warId).attacks.length === 4, 'replaying an attack action cannot choose a new route or earn a second score');
  assert(new Set(warService.getWar(challenge.warId).attackIds).size === 4, 'all generated attack IDs are unique and persisted');
  assert(!warService.submitWarAttack('iron-member', challenge.warId, 'assault', 'war-iron-over-cap').ok, 'community attack cap is enforced at two deployments');
  assert(warService.getWars('iron-admin')[0].id === warService.getWars('violet-owner')[0].id, 'both communities see the same service-owned active war after identity switching');
  assert(!warService.resolveWar('violet-owner', challenge.warId, 'war-resolve-before-stages-close').ok, 'timed build stages keep war open even after both attack caps');
  warClock = started.attackEndsAt;
  const resolved = warService.resolveWar('violet-owner', challenge.warId, 'war-resolve-once');
  assert(resolved.ok && resolved.state === 'resolved' && resolved.score['iron-pines'] === withdrawalOrder.score + liveWithdrawal.score, 'war resolves once with recorded field-order score totals after the timed stages close');
  assert(!warService.issueWarFieldOrder('iron-owner', challenge.warId, assault.attackId, 'withdrawal', 'cover', 'post-resolution').ok, 'battle commands close after war resolution');
  const tacticalReload = new LocalGameService({ storage: warStorage, now: () => warClock });
  const persistedTactics = tacticalReload.getWar(challenge.warId).attacks.find(attack => attack.attackId === ironRecon.attackId)?.tactics;
  assert(persistedTactics?.plan.lane === 'south' && persistedTactics.route.length === 4 && persistedTactics.scoreDelta === ironRecon.tactics.scoreDelta, 'the frozen tactical order and path survive save reload');
  const persistedSquad = tacticalReload.getWar(challenge.warId).attacks.find(attack => attack.attackId === ironRecon.attackId)?.squad;
  assert(persistedSquad?.counts.recon === reconCapacity - 2 && persistedSquad?.counts.engineer === 2 && persistedSquad.scoreDelta === ironRecon.squad.scoreDelta, 'selected troops, upgraded kit effects and exact army capacity survive reload');
  assert(resolved.wear.length === 4 && violetRidgewatch.wear === 1 && warService.state.communities['violet-ridge'].base.landPlots[1].wear === 1 && ironTimberline.wear === 2, 'incoming attacks mark only claimed built districts with bounded visual wear');
  assert(warService.getWorldMap().find(node => node.id === 'violet-ridge').districts.find(plot => plot.id === 'ridgewatch-range').wear === 1, 'public world preview shows district wear without exposing private inventory');
  const winnerRewards = resolved.rewards.filter(reward => warService.profile(reward.identityId).communityId === resolved.winnerCommunityId);
  const otherRewards = resolved.rewards.filter(reward => warService.profile(reward.identityId).communityId !== resolved.winnerCommunityId);
  assert(resolved.rewards.length === 4 && winnerRewards.length === 2 && winnerRewards.every(reward => reward.amount > WAR_RULES.localRewardParts && reward.amount <= Math.round(WAR_RULES.localRewardParts * 1.6)) && otherRewards.every(reward => reward.amount === WAR_RULES.localRewardParts) && resolved.rewards.every(reward => reward.ledgerId.startsWith(`war-reward:${challenge.warId}:`)), 'frozen high-risk victory pays bounded extra local Parts without changing scores or ledger IDs');
  assert(warService.snapshot('iron-owner').member.parts === ironStartParts + resolved.rewards.find(reward => reward.identityId === 'iron-owner').amount, 'war reward credits only local preview inventory');
  const repeatedResolve = warService.resolveWar('violet-owner', challenge.warId, 'war-resolve-once');
  assert(repeatedResolve.ok && repeatedResolve.replay && warService.state.warRewardLedger.length === 4 && violetRidgewatch.wear === 1, 'same resolve action replays without a second reward or damage');
  assert(warService.getChronicle('iron-owner').entries.filter(item => item.id === `war:${challenge.warId}`).length === 1 && warService.getChronicle('violet-owner').entries.filter(item => item.id === `war:${challenge.warId}`).length === 1, 'both war participants receive exactly one cosmetic Chronicle result');
  assert(!warService.resolveWar('iron-owner', challenge.warId, 'war-resolve-again').ok && warService.state.warRewardLedger.length === 4, 'a different action cannot resolve or reward an already resolved war');
  const persistedWarService = new LocalGameService({ storage: warStorage, now: () => warClock });
  const persistedWar = persistedWarService.getWar(challenge.warId);
  assert(persistedWar.state === 'resolved' && persistedWar.replay.attackIds.length === 4 && persistedWarService.state.warRewardLedger.length === 4, 'refresh/reload preserves the replay, score, resolution and once-only reward ledger');
  assert(persistedWarService.getChronicle('iron-owner').entries.some(item => item.id === `war:${challenge.warId}`), 'war Chronicle survives reload');
  checks.push('tactical scoring, live field orders, attack roster/caps, duplicate IDs, cross-community shared state, deterministic resolution, local rewards and reload');

  assert(!warService.setRepairPriority('violet-member', 'timberline-depot', 'wear-member-priority').ok, 'ordinary members cannot set repair priority');
  assert(!warService.setRepairPriority('violet-owner', 'signal-marsh', 'wear-undamaged-priority').ok, 'leadership cannot prioritise a district without wear');
  assert(!warService.repairDistrict('violet-member', 'timberline-depot', 'wear-out-of-order').ok, 'member repair respects leadership priority');
  assert(!warService.repairDistrict('violet-unverified', 'ridgewatch-range', 'wear-unverified').ok, 'unverified identities cannot repair');
  assert(!warService.repairDistrict('free-owner', 'ridgewatch-range', 'wear-free').ok, 'Free communities cannot repair another community');
  const priority = warService.setRepairPriority('violet-owner', 'timberline-depot', 'wear-owner-priority');
  assert(priority.ok && warService.state.communities['violet-ridge'].base.repairPriority === 'timberline-depot', 'owner can redirect the shared repair priority');
  assert(warService.setRepairPriority('violet-owner', 'timberline-depot', 'wear-owner-priority').replay, 'priority action is idempotent');
  const repairMember = warService.member('violet-member');
  repairMember.parts = BATTLE_WEAR_RULES.repairParts;
  repairMember.timber = BATTLE_WEAR_RULES.repairTimber;
  const scoreBeforeRepair = JSON.stringify(warService.getWar(challenge.warId).score);
  const repaired = warService.repairDistrict('violet-member', 'timberline-depot', 'wear-member-repair');
  assert(repaired.ok && repaired.completed && repairMember.parts === 0 && repairMember.timber === 0 && warService.state.communities['violet-ridge'].base.landPlots[1].wear === 0, 'verified member funds and completes one repair stage with personal resources');
  assert(warService.repairDistrict('violet-member', 'timberline-depot', 'wear-member-repair').replay && repairMember.parts === 0, 'repair replay cannot charge or repair twice');
  assert(warService.state.communities['violet-ridge'].base.repairPriority === 'ridgewatch-range' && violetRidgewatch.facilityLevel === 1 && JSON.stringify(warService.getWar(challenge.warId).score) === scoreBeforeRepair, 'next damaged district becomes priority while levels and settled battle score stay fixed');
  const repairReload = new LocalGameService({ storage: warStorage, now: () => warClock });
  assert(repairReload.state.communities['violet-ridge'].base.landPlots[1].wear === 0 && repairReload.state.communities['violet-ridge'].base.repairPriority === 'ridgewatch-range', 'repair state and priority survive reload');
  repairReload.state.communities['iron-pines'].base.landPlots[1].wear = 999;
  repairReload.state.communities['iron-pines'].base.repairPriority = 'missing-plot';
  repairReload.save();
  const sanitizedWear = new LocalGameService({ storage: warStorage, now: () => warClock }).state.communities['iron-pines'].base;
  assert(sanitizedWear.landPlots[1].wear === BATTLE_WEAR_RULES.maxSeverity && sanitizedWear.repairPriority === 'timberline-depot', 'loaded cosmetic wear is capped and stale priority is repaired');
  checks.push('battle wear, public preview, owner priority, member-funded repair, replay, score stability and reload');

  let worldClock = clock + 70_000;
  const worldStorage = new MemoryStorage();
  const worldService = new LocalGameService({ storage: worldStorage, now: () => worldClock });
  const worldBefore = worldService.getWorldMap();
  assert(worldBefore.length === 3 && worldBefore.every(node => node.illustrative && node.map.length === 2), 'world map identifies all local fixtures as illustrative placements');
  assert(worldBefore.find(node => node.id === 'mossback-free').accessTier === 'view only', 'Free community is inspectable but never shown as eligible to build');
  const worldProject = worldService.approveProject('iron-owner', 'hq', 'world-hall-approval');
  assert(worldProject.ok, 'owner approves a visible local construction project');
  assert(worldService.contributeToProject('iron-member', worldProject.projectId, 120, 'world-hall-fund').ok, 'verified connected member partially funds the project');
  const worldMap = worldService.getWorldMap();
  const ironMap = worldMap.find(node => node.id === 'iron-pines');
  assert(ironMap.construction.length === 1 && ironMap.construction[0].percent === 20 && ironMap.buildings.hq === 1, 'public projection shows scaffolding progress while the current building stays Level 1');
  assert(!/donors|treasury|salvage|lifetimeContributed|iron-member/.test(JSON.stringify(worldMap)), 'world projection omits private member, donor and balance data');
  assert(!worldService.contributeToProject('free-member', worldProject.projectId, 10, 'world-free-fund').ok && !worldService.contributeToProject('iron-unverified', worldProject.projectId, 10, 'world-unverified-fund').ok, 'map visibility does not grant Free or unverified construction writes');
  checks.push('illustrative world map, public construction projection, private-field exclusion and continued construction access gates');

  for (const id of ['iron-pines', 'violet-ridge']) worldService.state.communities[id].base.levels = { hq: 3, workshop: 2, tower: 2, comms: 2 };
  worldService.save();
  const worldChallenge = worldService.challengeWar('iron-owner', 'violet-ridge', 'world-war-challenge');
  assert(worldChallenge.ok && worldService.acceptWarChallenge('violet-owner', worldChallenge.warId, 'world-war-accept').ok, 'opponent accepts a world-map scout fixture');
  assert(!worldService.dispatchScout('iron-unverified', worldChallenge.warId, 'world-unverified-scout').ok && !worldService.dispatchScout('free-owner', worldChallenge.warId, 'world-free-scout').ok, 'only a verified participating Pro community member can dispatch a scout');
  const scout = worldService.dispatchScout('iron-owner', worldChallenge.warId, 'world-scout-once');
  assert(scout.ok && !worldService.getScoutReports('iron-owner', worldChallenge.warId)[0].intel, 'scout departs without instant defensive intel');
  assert(worldService.dispatchScout('iron-owner', worldChallenge.warId, 'world-scout-once').replay && worldService.state.scouts.length === 1, 'scout action replay never doubles the mission');
  assert(worldService.getScoutReports('violet-owner', worldChallenge.warId).length === 0 && worldService.getScoutReports('free-owner', worldChallenge.warId).length === 0, 'scout reports stay within the sending community');
  worldClock += WAR_RULES.scoutArrivalMs;
  assert(worldService.getScoutReports('iron-member', worldChallenge.warId)[0].intel?.hallLevel === 3, 'verified teammates receive defensive intel after travel');
  assert(worldService.startWar('violet-owner', worldChallenge.warId, 'world-war-start').ok, 'scout arrival coincides with the preparation timer');
  const counterattack = worldService.submitWarAttack('violet-owner', worldChallenge.warId, 'assault', 'world-counterattack');
  assert(counterattack.ok && counterattack.exposureBonus > 0, 'enemy scout deployment opens a bounded counterattack advantage');
  assert(!worldService.submitWarAttack('iron-owner', worldChallenge.warId, 'assault', 'world-scout-still-away').ok, 'a member cannot use the same squad for scouting and assault at once');
  const recallScout = worldService.recallScout('iron-owner', scout.scoutId, 'world-scout-recall');
  assert(recallScout.ok && !worldService.getAwaySquads('iron-pines', worldChallenge.warId).some(squad => squad.id === scout.scoutId), 'scout recall ends home exposure immediately');
  assert(worldService.recallScout('iron-owner', scout.scoutId, 'world-scout-recall').replay && !worldService.recallScout('iron-owner', scout.scoutId, 'world-scout-again').ok, 'scout recall is once-only and replay-safe');
  const informedAttack = worldService.submitWarAttack('iron-owner', worldChallenge.warId, 'recon', 'world-informed-attack');
  assert(informedAttack.ok && informedAttack.scoutBonus === 4 && informedAttack.exposureBonus > 0, 'returned scout intel and defender-away exposure affect deterministic scoring');
  const recallAttack = worldService.recallWarSquad('violet-owner', worldChallenge.warId, counterattack.attackId, 'world-attack-recall');
  assert(recallAttack.ok && recallAttack.penalty === Math.ceil(counterattack.score / 4), 'a player may return to defend at the stated 25% attack-point cost');
  assert(worldService.recallWarSquad('violet-owner', worldChallenge.warId, counterattack.attackId, 'world-attack-recall').replay && !worldService.recallWarSquad('violet-owner', worldChallenge.warId, counterattack.attackId, 'world-attack-recall-again').ok, 'war squad recall cannot deduct score twice');
  const worldReload = new LocalGameService({ storage: worldStorage, now: () => worldClock });
  assert(worldReload.getWar(worldChallenge.warId).score['violet-ridge'] === recallAttack.totalScore && worldReload.getScoutReports('iron-owner', worldChallenge.warId)[0].recalledAt === recallScout.recalledAt, 'scout, attack, recall and score survive a refresh');
  worldClock += WAR_RULES.squadReturnMs;
  assert(worldReload.getAwaySquads('iron-pines', worldChallenge.warId).length === 0, 'away exposure expires on the service clock');
  checks.push('scout travel, team intel, Pro roster gates, exposure counterattack, squad recall, replay, reload and timed return');

  const layoutStorage = new MemoryStorage();
  const layoutService = new LocalGameService({ storage: layoutStorage, now: () => clock });
  layoutService.state.members['iron-owner'].timber = 100;
  layoutService.state.communities['iron-pines'].base.levels.hq = 3;
  assert(!layoutService.moveStructure('iron-member', 'workshop', -10, 4, 'layout-member-move').ok && !layoutService.moveStructure('iron-admin', 'workshop', -10, 4, 'layout-admin-move').ok, 'only the verified owner can reposition a structure');
  assert(!layoutService.moveStructure('iron-owner', 'workshop', 0, 0, 'layout-overlap').ok && !layoutService.moveStructure('iron-owner', 'workshop', -30, 4, 'layout-outside').ok, 'placement rejects occupied or locked grid cells');
  assert(layoutService.moveStructure('iron-owner', 'workshop', -10, 4, 'layout-owner-move').ok, 'owner moves a building inside the unlocked Command Compound');
  const row = layoutService.placeWallRow('iron-owner', { x: 0, z: 10 }, { x: 4, z: 10 }, 'layout-three-walls');
  assert(row.ok && row.walls.length === 3 && row.partsCost === 45 && row.timberCost === 30, 'straight row places three distinct wall segments for the exact combined cost');
  assert(layoutService.placeWallRow('iron-owner', { x: 0, z: 10 }, { x: 4, z: 10 }, 'layout-three-walls').replay && layoutService.snapshot('iron-owner').base.layout.walls.length === 3, 'row replay never creates or bills duplicate walls');
  const beforeRejectedRow = layoutService.snapshot('iron-owner').member;
  assert(!layoutService.placeWallRow('iron-owner', { x: 4, z: 10 }, { x: 8, z: 10 }, 'layout-colliding-row').ok && layoutService.snapshot('iron-owner').member.parts === beforeRejectedRow.parts && layoutService.snapshot('iron-owner').member.timber === beforeRejectedRow.timber, 'a blocked row is rejected atomically without resource loss');
  const upgradedRow = layoutService.upgradeWallRow('iron-owner', { x: 0, z: 10 }, { x: 4, z: 10 }, 'layout-upgrade-three');
  assert(upgradedRow.ok && upgradedRow.walls.every(wall => wall.level === 2) && upgradedRow.partsCost === 75 && upgradedRow.timberCost === 45, 'owner upgrades a whole row with tiered DZN costs');
  assert(!layoutService.upgradeWallRow('iron-owner', { x: 0, z: 10 }, { x: 6, z: 10 }, 'layout-partial-upgrade').ok, 'upgrade row requires every segment to exist');
  assert(layoutService.moveWall('iron-owner', row.walls[0].id, 6, 12, 'layout-move-wall').ok, 'owner can move one paid wall to another open grid cell');
  assert(!layoutService.saveBlueprint('iron-member', 1, 'West watch', 'blueprint-member').ok, 'members cannot save the shared defence arrangement');
  const savedBlueprint = layoutService.saveBlueprint('iron-owner', 1, 'West watch', 'blueprint-west');
  assert(savedBlueprint.ok && layoutService.saveBlueprint('iron-owner', 1, 'West watch', 'blueprint-west').replay && layoutService.getBlueprints('iron-owner')[0].ready, 'owner saves one of three idempotent defence plans');
  assert(layoutService.moveWall('iron-owner', row.walls[0].id, 8, 12, 'blueprint-shift').ok, 'owner can change the live wall layout after saving a plan');
  assert(layoutService.saveBlueprint('iron-owner', 2, 'East watch', 'blueprint-east').ok, 'second slot captures another wall arrangement');
  const inventoryBeforeDrill = JSON.stringify(layoutService.snapshot('iron-owner'));
  const defenceDrill = layoutService.drillBlueprint('iron-member', 1);
  assert(defenceDrill.ok && defenceDrill.lanes.length === 3 && defenceDrill.lanes.every(lane => !lane.error && Number.isInteger(lane.score)) && defenceDrill.reward === 0, 'eligible member can run three deterministic local attacks against a saved layout');
  assert(JSON.stringify(layoutService.snapshot('iron-owner')) === inventoryBeforeDrill, 'friendly defence test changes no inventory, score, walls or save state');
  assert(!layoutService.applyBlueprint('iron-member', 1, 'blueprint-member-apply').ok, 'member cannot deploy an owner blueprint');
  assert(layoutService.applyBlueprint('iron-owner', 1, 'blueprint-apply-west').ok && layoutService.snapshot('iron-owner').base.layout.walls.find(wall => wall.id === row.walls[0].id).x === 6, 'deploying a blueprint repositions the same paid wall');
  assert(layoutService.applyBlueprint('iron-owner', 1, 'blueprint-apply-west').replay && layoutService.snapshot('iron-owner').base.layout.walls.every(wall => wall.level === 2), 'replay cannot duplicate walls or roll back their paid tiers');
  const layoutReload = new LocalGameService({ storage: layoutStorage, now: () => clock });
  assert(layoutReload.snapshot('iron-owner').base.layout.structures.workshop.x === -10 && layoutReload.snapshot('iron-owner').base.layout.walls.find(wall => wall.id === row.walls[0].id).z === 12 && layoutReload.getBlueprints('iron-owner')[1].ready, 'layout, wall tiers and both blueprints persist across reload');
  assert(layoutService.placeWallRow('iron-owner', { x: -10, z: 0 }, undefined, 'blueprint-extra-wall').ok && !layoutService.getBlueprints('iron-owner')[0].ready && !layoutService.applyBlueprint('iron-owner', 1, 'blueprint-stale').ok, 'new wall makes older blueprints stale rather than creating or deleting a wall for free');
  assert(layoutService.saveBlueprint('iron-owner', 1, 'West watch', 'blueprint-refresh').ok && layoutService.getBlueprints('iron-owner')[0].ready, 'resaving refreshes a stale plan for the owned wall inventory');
  assert(layoutService.drillBlueprint('iron-owner', 1).lanes.find(lane => lane.lane === 'west').wallCount === 1, 'friendly drill calculates pressure from the actual saved wall corridor');
  for (const id of ['iron-pines', 'violet-ridge']) layoutService.state.communities[id].base.levels = { hq: 3, workshop: 2, tower: 2, comms: 2 };
  const layoutWar = layoutService.challengeWar('iron-owner', 'violet-ridge', 'layout-war-snapshot');
  assert(layoutWar.ok && layoutService.getWar(layoutWar.warId).snapshots.challenger.stats.fortification === 2, 'built wall tiers add bounded defence to the accepted war snapshot');
  assert(!layoutService.applyBlueprint('iron-owner', 1, 'blueprint-war-swap').ok, 'pending war prevents a saved-plan swap');
  assert(layoutService.moveWall('iron-owner', row.walls[0].id, 8, 12, 'layout-after-challenge').ok && layoutService.getWar(layoutWar.warId).snapshots.challenger.base.layout.walls.find(wall => wall.id === row.walls[0].id).x === 6, 'later owner layout changes cannot rewrite the opponent-facing war base');
  checks.push('owner-only grid placement, paid wall rows, three saved defence plans, free friendly drills, stale-plan gates, war lock and persistence');

  let stageClock = clock + 140_000;
  const stageStorage = new MemoryStorage();
  const stageService = new LocalGameService({ storage: stageStorage, now: () => stageClock });
  for (const id of ['iron-pines', 'violet-ridge']) stageService.state.communities[id].base.levels = { hq: 3, workshop: 2, tower: 2, comms: 2 };
  stageService.state.members['iron-owner'].timber = 30;
  stageService.state.members['violet-owner'].timber = 30;
  const stageChallenge = stageService.challengeWar('iron-owner', 'violet-ridge', 'stages-challenge');
  assert(stageChallenge.ok && stageService.acceptWarChallenge('violet-owner', stageChallenge.warId, 'stages-accept').ok, 'two eligible servers enter timed challenge preparation');
  stageClock += WAR_RULES.preparationReadyMs;
  assert(stageService.startWar('iron-owner', stageChallenge.warId, 'stages-start').ok, 'stage schedule starts with the accepted war');
  const stageWar = stageService.getWar(stageChallenge.warId);
  assert(stageWar.stages.length === 3 && stageWar.stages[0].opensAt === stageClock && stageWar.stages[2].closesAt === stageWar.attackEndsAt, 'three build-specific stages cover the complete battle window');
  assert(!stageService.completeWarStage('iron-unverified', stageChallenge.warId, WAR_STAGE_DEFS[0].id, 'stage-unverified').ok && !stageService.completeWarStage('free-owner', stageChallenge.warId, WAR_STAGE_DEFS[0].id, 'stage-free').ok, 'unverified and Free identities cannot complete stage tasks');
  const firstStage = stageService.completeWarStage('iron-owner', stageChallenge.warId, WAR_STAGE_DEFS[0].id, 'stage-iron-forge');
  const rivalStage = stageService.completeWarStage('violet-owner', stageChallenge.warId, WAR_STAGE_DEFS[0].id, 'stage-violet-forge');
  assert(firstStage.ok && rivalStage.ok && firstStage.points === rivalStage.points + 2 && stageService.completeWarStage('iron-owner', stageChallenge.warId, WAR_STAGE_DEFS[0].id, 'stage-iron-forge').replay, 'first server earns a bounded bonus and duplicate stage action replays without points');
  assert(!stageService.completeWarStage('iron-admin', stageChallenge.warId, WAR_STAGE_DEFS[0].id, 'stage-iron-forge-again').ok && !stageService.completeWarStage('iron-owner', stageChallenge.warId, WAR_STAGE_DEFS[1].id, 'stage-too-early').ok, 'one completion per server per stage and future windows stay closed');
  stageClock = stageWar.stages[1].opensAt;
  assert(stageService.completeWarStage('iron-owner', stageChallenge.warId, WAR_STAGE_DEFS[1].id, 'stage-iron-relay').ok, 'relay stage opens at its scheduled time');
  stageClock = stageWar.stages[2].opensAt;
  assert(stageService.completeWarStage('iron-owner', stageChallenge.warId, WAR_STAGE_DEFS[2].id, 'stage-iron-tower').ok, 'final Watchtower stand consumes the remaining Timber and adds points');
  const stageScore = stageService.getWar(stageChallenge.warId).score['iron-pines'];
  const stageReload = new LocalGameService({ storage: stageStorage, now: () => stageClock });
  assert(stageReload.getWar(stageChallenge.warId).score['iron-pines'] === stageScore && stageReload.getWar(stageChallenge.warId).stages[2].completedBy['iron-pines'].points > 0, 'stage progress survives reload with immutable building tiers');
  stageClock = stageWar.attackEndsAt;
  assert(!stageReload.completeWarStage('violet-owner', stageChallenge.warId, WAR_STAGE_DEFS[2].id, 'stage-late').ok && stageReload.resolveWar('iron-owner', stageChallenge.warId, 'stage-resolve').ok, 'late stages close exactly at the deadline and leadership resolves the shared score');
  checks.push('three timed build challenges, roster and Pro gates, bounded first bonus, once-only scores, reload and deadline');

  const olderSave = JSON.parse(storage.getItem(SERVICE_STORAGE_KEY));
  delete olderSave.communities['iron-pines'].base.chronicle;
  const earlier = new LocalGameService({ storage: new MemoryStorage({ [SERVICE_STORAGE_KEY]: JSON.stringify(olderSave) }), now: () => clock });
  assert(earlier.getChronicle('iron-owner').entries.some(item => item.id === `project:${hallProjectId}`), 'older saves show completed work without inventing new rewards');
  assert(earlier.getChronicle('iron-owner').beaconLevel === earlier.snapshot('iron-owner').base.levels.hq, 'beacon stage follows the saved Hall level');
  assert(earlier.setOwnerProActive('iron-owner', false).ok && !earlier.getChronicle('iron-member').ok, 'owner Pro suspension locks Chronicle viewing while keeping the save');
  checks.push('Server Chronicle: completed-only milestones, verified Pro viewing, community isolation, replay, reload and older saves');

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

  let missionClock = clock + 300_000;
  const fieldStops = Object.values(EXPEDITION_FIELD.choices).flat();
  assert(fieldStops.every(stop => expeditionFieldWalkable(stop.x, stop.z)), 'every expedition decision has a reachable physical checkpoint');
  for (const from of [EXPEDITION_FIELD.start, ...fieldStops]) for (const to of fieldStops) {
    const path = expeditionFieldPath(from, to);
    assert(path?.length && path.every(point => expeditionFieldWalkable(point.x, point.z))
      && path[0].x === from.x && path[0].z === from.z && path.at(-1).x === to.x && path.at(-1).z === to.z,
    'Outpost Ember routes avoid solid cover between every pair of checkpoints');
  }
  assert(expeditionFieldPath(EXPEDITION_FIELD.start, { x: 0, z: -1 }) === null
    && expeditionFieldPath({ x: 500, z: 500 }, fieldStops[0]) === null,
  'the field never routes through cover or outside its boundary');
  checks.push('spatial Outpost Ember routes and checkpoint bounds');
  const missionStorage = new MemoryStorage();
  let missionGame = new LocalGameService({ storage: missionStorage, now: () => missionClock });
  let ops = new OperationsController(missionGame);
  assert(Object.keys(OPERATIVES).length === 3 && ops.getBoard('iron-owner').capacity === 4, 'three original operatives use the Hall command budget');
  assert(!ops.startExpedition('iron-unverified', { assault: 1 }, 'mission-locked').ok && !ops.startExpedition('free-owner', { assault: 1 }, 'mission-free').ok, 'expeditions require verified community owner Pro access');
  const startingSalvage = missionGame.member('iron-member').salvage;
  assert(!ops.startExpedition('iron-member', { assault: 3 }, 'mission-over-budget').ok && missionGame.member('iron-member').salvage === startingSalvage, 'commander plus ordinary troops cannot exceed the shared capacity');
  assert(!ops.startExpedition('iron-member', { medic: 1 }, 'mission-locked-medic').ok, 'ordinary specialist troops still follow their existing building unlocks');
  const rivetStart = ops.startExpedition('iron-member', { assault: 1, engineer: 1 }, 'mission-rivet-start');
  assert(rivetStart.ok && missionGame.member('iron-member').salvage === startingSalvage - EXPEDITION_RULES.launchSalvage, 'mission launch spends personal Salvage exactly once');
  assert(ops.current('iron-member').fieldPosition.x === EXPEDITION_FIELD.start.x
    && ops.current('iron-member').fieldPosition.z === EXPEDITION_FIELD.start.z, 'new expeditions start at the field entry checkpoint');
  assert(ops.startExpedition('iron-member', { assault: 1, engineer: 1 }, 'mission-rivet-start').replay && missionGame.member('iron-member').salvage === startingSalvage - EXPEDITION_RULES.launchSalvage, 'replay does not create a second attempt or spend again');
  assert(!ops.startExpedition('iron-owner', { assault: 1 }, 'mission-rivet-start').ok, 'another member cannot reuse the same action ID');
  assert(!ops.useAbility('iron-member', 'tactical', 'rivet-too-early').ok, 'breach charge has a visible valid-target gate');
  assert(ops.advance('iron-member', 'scout', 'rivet-scout').ok && ops.current('iron-member').scanned, 'approach scouting records useful route intelligence');
  assert(ops.current('iron-member').fieldPosition.x === -9 && ops.current('iron-member').fieldPosition.z === -11,
    'selected 3D field checkpoint is saved with the mission action');
  assert(ops.chooseFieldUpgrade('iron-member', 'cover', 'rivet-cover').ok && !ops.chooseFieldUpgrade('iron-member', 'route', 'rivet-cover-twice').ok, 'temporary Field Upgrade is a single bounded choice');
  assert(ops.useAbility('iron-member', 'tactical', 'rivet-breach').ok && ops.current('iron-member').phase === 'cache', 'Rivet opens a barrier without replacing ordinary troops');
  assert(ops.advance('iron-member', 'secure', 'rivet-cache').ok && ops.advance('iron-member', 'extract', 'rivet-extract').status === 'extracted', 'safer cache reaches an actual extraction outcome');
  assert(ops.current('iron-member').reward === 30 && ops.current('iron-member').cargo === 40 && missionGame.member('iron-member').parts === 630, 'rapid pickup saves the convoy but delivers only 75 percent of collected cargo');
  const partsAfterExtraction = missionGame.member('iron-member').parts;
  assert(ops.advance('iron-member', 'extract', 'rivet-extract').replay && missionGame.member('iron-member').parts === partsAfterExtraction, 'duplicate extraction never duplicates personal Parts');
  assert(ops.showcase('iron-member').earned.firstThrough && ops.showcase('iron-member').earned.eyesOnTarget && ops.showcase('iron-member').mastery.rivet === 1, 'earned PvE badges and mastery follow the recorded completed attempt');
  missionGame = new LocalGameService({ storage: missionStorage, now: () => missionClock }); ops = new OperationsController(missionGame);
  assert(ops.current('iron-member').status === 'extracted' && missionGame.member('iron-member').parts === partsAfterExtraction && ops.showcase('iron-member').completed === 1, 'mission, reward ledger and evidence survive reload without another grant');
  assert(ops.current('iron-member').fieldPosition.x === -9 && ops.current('iron-member').fieldPosition.z === 15,
    'extraction checkpoint survives reload for deterministic field reconstruction');
  assert(ops.getBoard('iron-member').history[0].extractionMode === 'rapid' && ops.getBoard('iron-member').history[0].events.some(event => event.text.includes('Rapid convoy')) && ops.getBoard('iron-member').history[0].events.at(-1).text.includes('30 Parts'), 'after-action evidence preserves the pickup choice and actual once-only payout');
  assert(ops.prepareNext('iron-member', 'mission-next').ok && ops.showcase('iron-member').completed === 1, 'next-run preparation retains permanent mastery and reward evidence');
  assert(ops.getBoard('iron-member').history[0].events.length > 1, 'preparing a new attempt does not erase the earlier field record');
  checks.push('operative command slot, local Pro gate, ordinary troop unlocks, tactical targets, one Field Upgrade, extraction ledger and mastery persistence');

  const remedyGame = new LocalGameService({ storage: new MemoryStorage(), now: () => missionClock });
  const remedyOps = new OperationsController(remedyGame);
  assert(remedyOps.selectOperative('iron-owner', 'remedy', 'remedy-select').ok, 'member selects an original recovery operative');
  assert(remedyOps.startExpedition('iron-owner', { assault: 1, recon: 1 }, 'remedy-start').ok, 'Remedy fills the command slot without unlocking the ordinary medic troop');
  assert(remedyOps.advance('iron-owner', 'push', 'remedy-ambush').ok && remedyOps.current('iron-owner').casualties === 1, 'unscouted approach causes one finite incapacitation');
  assert(remedyOps.useAbility('iron-owner', 'tactical', 'remedy-recover').ok && remedyOps.current('iron-owner').recovered === 1 && remedyOps.current('iron-owner').recoveriesLeft === 0, 'Trauma Station recovers a casualty and consumes a charge');
  assert(remedyOps.chooseFieldUpgrade('iron-owner', 'triage', 'remedy-triage').ok, 'temporary triage adds only one charge');
  assert(remedyOps.advance('iron-owner', 'force', 'remedy-force').ok && remedyOps.current('iron-owner').casualties === 1, 'forced breach can incapacitate another troop');
  assert(remedyOps.useAbility('iron-owner', 'ultimate', 'remedy-ultimate').ok && remedyOps.current('iron-owner').recovered === 2 && !remedyOps.useAbility('iron-owner', 'ultimate', 'remedy-ultimate-again').ok, 'one ultimate cannot produce unlimited recoveries');
  assert(remedyOps.advance('iron-owner', 'secure', 'remedy-cache').ok && remedyOps.advance('iron-owner', 'hold', 'remedy-extract').ok && remedyOps.showcase('iron-owner').earned.siegeMedic, 'meaningful recovered casualties count only after extraction');
  assert(remedyOps.current('iron-owner').reward === 40 && remedyOps.getBoard('iron-owner').history[0].extractionMode === 'held' && remedyOps.getBoard('iron-owner').history[0].events.some(event => event.text.includes('Held the extraction beacon')), 'holding the beacon takes hazard but pays full collected cargo and records why');
  const hazardGame = new LocalGameService({ storage: new MemoryStorage(), now: () => missionClock });
  const hazardOps = new OperationsController(hazardGame);
  assert(hazardOps.startExpedition('iron-owner', { assault: 1 }, 'hazard-start').ok, 'high-risk route starts with an ordinary unit');
  assert(hazardOps.advance('iron-owner', 'push', 'hazard-push').ok && hazardOps.advance('iron-owner', 'force', 'hazard-force').ok && hazardOps.advance('iron-owner', 'extra', 'hazard-extra').ok, 'rushing, forced entry and extra cargo consume finite protection');
  assert(hazardOps.advance('iron-owner', 'hold', 'hazard-hold').status === 'failed' && hazardGame.member('iron-owner').parts === 600 && hazardOps.getBoard('iron-owner').history[0].reward === 0, 'reckless full-cargo hold can fail and cannot award Parts');
  assert(hazardOps.advance('iron-owner', 'hold', 'hazard-hold').replay && hazardGame.member('iron-owner').parts === 600, 'retrying the failed extraction action cannot mint cargo');
  checks.push('bounded incapacitation, recovery charges, once-per-attempt ultimate and evidence-backed medic award');

  const pingGame = new LocalGameService({ storage: new MemoryStorage(), now: () => missionClock });
  const pingOps = new OperationsController(pingGame);
  const posted = pingOps.postPing('iron-member', 'scout', 'west shutter', 'ping-west');
  assert(posted.ok && pingOps.getBoard('iron-owner').pings.length === 1 && pingOps.getBoard('violet-owner').pings.length === 0, 'signals stay within their preview community');
  assert(pingOps.acknowledgePing('iron-owner', posted.pingId, 'ping-ack').ok && !pingOps.acknowledgePing('violet-owner', posted.pingId, 'ping-cross').ok, 'only an eligible same-community member can acknowledge a signal');
  pingGame.setOwnerProActive('iron-owner', false);
  assert(pingOps.getBoard('iron-member').pings.length === 0 && !pingOps.postPing('iron-member', 'hold', 'gate', 'ping-pro-off').ok, 'inactive owner Pro hides private signals and locks new signals');
  pingGame.setOwnerProActive('iron-owner', true);
  missionClock += EXPEDITION_RULES.pingLifetimeMs;
  assert(pingOps.getBoard('iron-member').pings.length === 0, 'signals expire at their published time');
  const expiryGame = new LocalGameService({ storage: new MemoryStorage(), now: () => missionClock });
  const expiryOps = new OperationsController(expiryGame);
  assert(expiryOps.startExpedition('iron-owner', { assault: 1 }, 'expiry-start').ok, 'fresh attempt starts before deadline');
  const salvageSpent = expiryGame.member('iron-owner').salvage;
  missionClock += EXPEDITION_RULES.durationMs;
  assert(expiryOps.current('iron-owner').status === 'expired' && expiryGame.member('iron-owner').salvage === salvageSpent && expiryGame.member('iron-owner').parts === 600, 'timeout closes the same attempt without refund or reward');
  checks.push('scoped and expiring community pings, Pro privacy, mission deadline and no timeout reward');

  return { passed: checks.length, checks };
}
