export function applyOperatorPose(model: { rotation: { y: number }; traverse: (callback: (node: { name?: string; rotation?: { z: number; x: number } }) => void) => void }, poseItemId: string) {
  if (poseItemId.includes("recon-scan")) model.rotation.y = -0.16;
  if (poseItemId.includes("victory-angle")) model.rotation.y = 0.2;
  model.traverse((node) => {
    if (!node.rotation || !node.name) return;
    if (poseItemId.includes("patrol-hold") && node.name.includes("forearm")) node.rotation.z += node.name.includes("left") ? -0.32 : 0.32;
    if (poseItemId.includes("pathfinder-kneel") && node.name.includes("thigh")) node.rotation.x += 0.18;
    if (poseItemId.includes("vanguard") && node.name.includes("torso")) node.rotation.x -= 0.06;
  });
}
