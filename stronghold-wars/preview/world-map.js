// World coordinates in the local preview are illustrative map markers only.
// The route estimate uses great-circle geometry but is never a live player location.
const radians = degrees => degrees * Math.PI / 180;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function illustrativeLatLon([x, y]) {
  return [90 - y * 1.8, x * 3.6 - 180];
}

export function greatCircleKm(a, b) {
  const [latA, lonA] = illustrativeLatLon(a).map(radians);
  const [latB, lonB] = illustrativeLatLon(b).map(radians);
  const value = Math.sin((latB - latA) / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin((lonB - lonA) / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(clamp(value, 0, 1))));
}

export function routeBriefing(origin, target) {
  const distanceKm = greatCircleKm(origin.map, target.map);
  const hours = Math.round((1.5 + distanceKm / 850) * 2) / 2;
  const assignedDefenders = Object.values(target.defenders || {}).filter(unit => unit.level && unit.post).length;
  const risk = clamp(Math.round(1 + distanceKm / 3500 + Math.max(0, target.hallLevel - origin.hallLevel) * .7 + assignedDefenders * .2), 1, 5);
  return {
    distanceKm,
    travelHours: hours,
    risk,
    riskLabel: ['','Low','Guarded','Elevated','Severe','Extreme'][risk],
    rewardMultiplier: Number((1 + (risk - 1) * .15).toFixed(2)),
  };
}

export function connectedProMatches(communities, query = '') {
  const needle = String(query).trim().toLocaleLowerCase();
  return communities.filter(community => community.accessTier === 'owner Pro active' && community.name.toLocaleLowerCase().includes(needle));
}
