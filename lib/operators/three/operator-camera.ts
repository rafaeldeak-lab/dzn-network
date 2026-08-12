export type OperatorCameraView = "front" | "rear" | "left" | "right";

export function getCameraPosition(view: OperatorCameraView): [number, number, number] {
  if (view === "rear") return [0, 1.38, -5.4];
  if (view === "left") return [-5.4, 1.38, 0];
  if (view === "right") return [5.4, 1.38, 0];
  return [0, 1.38, 5.4];
}
