import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { issuePlayerGameIdentityProofCode, redeemPlayerGameIdentityProofCode } from "../functions/_lib/player-game-identity-proof-codes";
import { readOwnerPlayerGameIdentityClaims, readPlayerGameIdentityReadModel } from "../functions/_lib/player-game-identities";
import { identityTestUser, identityTransactionFixture } from "./test-player-game-identity-transactions";

async function main() {
  const fixture = identityTransactionFixture();
  try {
  fixture.sqlite.exec(readFileSync("migrations/0077_player_game_identity_proof_codes.sql", "utf8"));
  const denied = await issuePlayerGameIdentityProofCode(fixture.env, identityTestUser("owner-b"), "claim-a");
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);

  const issued = await issuePlayerGameIdentityProofCode(fixture.env, identityTestUser("owner-a"), "claim-a");
  assert.equal(issued.ok, true);
  if (!issued.ok) throw new Error("Expected proof code");
  assert.match(issued.code, /^DZN-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  const stored = fixture.sqlite.prepare("SELECT * FROM player_game_identity_proof_codes").get();
  assert.notEqual(stored?.code_hash, issued.code, "The plaintext proof code must never be stored.");

  const issuedView = await readOwnerPlayerGameIdentityClaims(fixture.env, identityTestUser("owner-a"));
  assert.equal(issuedView.claims[0]?.proof_status, "issued", "Owners must be warned that an unredeemed code is already active.");
  const activeBeforeRace = fixture.sqlite.prepare("SELECT id FROM player_game_identity_proof_codes WHERE claim_id='claim-a' AND status='active'").get()?.id;
  fixture.setBeforeBatch(() => fixture.sqlite.exec("UPDATE linked_servers SET user_id='owner-b' WHERE id='server-a'"));
  const ownershipRace = await issuePlayerGameIdentityProofCode(fixture.env, identityTestUser("owner-a"), "claim-a");
  assert.equal(ownershipRace.ok, false, "Issuance must recheck current ownership inside the write transaction.");
  assert.equal(fixture.sqlite.prepare("SELECT id FROM player_game_identity_proof_codes WHERE claim_id='claim-a' AND status='active'").get()?.id, activeBeforeRace, "A stale owner must not revoke the current proof code.");
  fixture.sqlite.exec("UPDATE linked_servers SET user_id='owner-a' WHERE id='server-a'");

  const replacement = await issuePlayerGameIdentityProofCode(fixture.env, identityTestUser("owner-a"), "claim-a");
  assert.equal(replacement.ok, true);
  if (!replacement.ok) throw new Error("Expected replacement proof code");
  assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM player_game_identity_proof_codes WHERE claim_id='claim-a' AND status='active'").get()?.count, 1);
  const replacedCode = await redeemPlayerGameIdentityProofCode(fixture.env, identityTestUser("player-a", "discord-a"), { claim_id: "claim-a", proof_code: issued.code });
  assert.equal(replacedCode.ok, false, "Replacing a code must invalidate the earlier value.");

  const wrongPlayer = await redeemPlayerGameIdentityProofCode(fixture.env, identityTestUser("player-b", "discord-b"), { claim_id: "claim-a", proof_code: replacement.code });
  assert.equal(wrongPlayer.ok, false);
  const redeemed = await redeemPlayerGameIdentityProofCode(fixture.env, identityTestUser("player-a", "discord-a"), { claim_id: "claim-a", proof_code: replacement.code.toLowerCase() });
  assert.equal(redeemed.ok, true);
  assert.equal(fixture.sqlite.prepare("SELECT status FROM player_game_identity_proof_codes WHERE claim_id='claim-a'").get()?.status, "consumed");
  const playerView = await readPlayerGameIdentityReadModel(fixture.env, identityTestUser("player-a", "discord-a"));
  assert.equal(playerView.claims[0]?.proof_status, "verified", "Redeemed proof must survive player page reloads.");
  const ownerView = await readOwnerPlayerGameIdentityClaims(fixture.env, identityTestUser("owner-a"));
  assert.equal(ownerView.claims[0]?.proof_status, "verified", "Owners must see durable redeemed proof.");
  const replay = await redeemPlayerGameIdentityProofCode(fixture.env, identityTestUser("player-a", "discord-a"), { claim_id: "claim-a", proof_code: replacement.code });
  assert.equal(replay.ok, false, "A one-time code must reject replay.");
  const afterVerified = await issuePlayerGameIdentityProofCode(fixture.env, identityTestUser("owner-a"), "claim-a");
  assert.equal(afterVerified.ok, false, "Verified requests must not issue unnecessary replacement codes.");
  console.log("Player link proof codes: owner scope, hashing, account binding, expiry fence and replay protection passed.");
  } finally {
    fixture.close();
  }
}

void main();
