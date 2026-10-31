// Art-first collection preview. Scarcity and issuance need a reviewed server ledger.
export const FIRST_EDITION_CARDS = Object.freeze([
  Object.freeze({ id: 'guardian', name: 'DZN Guardian', rarity: 'Legendary', image: 'assets/cards/guardian-first-edition.png', condition: 'Assign a Guardian to a defensive post.' }),
  Object.freeze({ id: 'ghost', name: 'DZN Ghost', rarity: 'Epic', image: 'assets/cards/ghost-first-edition.png', condition: 'Reach Communications Level 3.' }),
  Object.freeze({ id: 'fixer', name: 'DZN Fixer', rarity: 'Epic', image: 'assets/cards/fixer-first-edition.png', condition: 'Build Timberline Lumber Yard Level 2.' }),
]);

export function cardEarned(cardId, base) {
  if (cardId === 'guardian') return Boolean(base.defenders?.guardian?.level && base.defenders.guardian.post);
  if (cardId === 'ghost') return (base.levels?.comms || 0) >= 3;
  if (cardId === 'fixer') return (base.landPlots?.find(plot => plot.id === 'timberline-depot')?.facilityLevel || 0) >= 2;
  return false;
}
