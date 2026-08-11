import type { CSSProperties } from "react";

import type { OperatorCardPresentation } from "@/lib/operators/types";

type OperatorAvatarProps = {
  presentation: OperatorCardPresentation;
  size?: "sm" | "md" | "lg";
};

const sizeClass = {
  sm: "h-40",
  md: "h-64",
  lg: "h-[28rem]",
} satisfies Record<NonNullable<OperatorAvatarProps["size"]>, string>;

export function OperatorAvatar({ presentation, size = "md" }: OperatorAvatarProps) {
  const upper = presentation.selectedItems.upper_body.preview.swatch;
  const outer = presentation.selectedItems.outerwear.preview.swatch;
  const trim = presentation.palette.trim;
  const background = presentation.selectedItems.background.preview.swatch;
  const pose = presentation.selectedItems.pose.id;

  return (
    <div
      className={`relative isolate overflow-hidden rounded-lg border border-white/10 bg-black/30 ${sizeClass[size]}`}
      aria-label={`${presentation.displayName} visual preview`}
      style={{
        "--operator-primary": upper,
        "--operator-secondary": outer,
        "--operator-trim": trim,
        "--operator-background": background,
      } as CSSProperties}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_20%,color-mix(in_srgb,var(--operator-trim)_28%,transparent),transparent_32%),linear-gradient(135deg,color-mix(in_srgb,var(--operator-background)_42%,#02030a),#02030a_70%)]" />
      <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.035)_1px,transparent_1px)] [background-size:34px_34px]" />
      <div className="absolute left-1/2 top-[13%] h-[18%] w-[23%] -translate-x-1/2 rounded-[42%_42%_38%_38%] border border-white/14 bg-[linear-gradient(135deg,#d4d4d8,#71717a)] shadow-[0_0_28px_rgba(255,255,255,.14)]" />
      <div className="absolute left-1/2 top-[30%] h-[43%] w-[38%] -translate-x-1/2 rounded-[24px_24px_18px_18px] border border-white/12 bg-[linear-gradient(145deg,var(--operator-primary),color-mix(in_srgb,var(--operator-primary)_42%,#02030a))] shadow-[0_20px_60px_rgba(0,0,0,.46)]" />
      <div className="absolute left-[29%] top-[33%] h-[34%] w-[10%] rotate-6 rounded-full border border-white/8 bg-[linear-gradient(180deg,var(--operator-secondary),#02030a)]" />
      <div className="absolute right-[29%] top-[33%] h-[34%] w-[10%] -rotate-6 rounded-full border border-white/8 bg-[linear-gradient(180deg,var(--operator-secondary),#02030a)]" />
      <div className="absolute left-[38%] top-[70%] h-[23%] w-[10%] rotate-3 rounded-full border border-white/8 bg-[linear-gradient(180deg,#1f2937,#02030a)]" />
      <div className="absolute right-[38%] top-[70%] h-[23%] w-[10%] -rotate-3 rounded-full border border-white/8 bg-[linear-gradient(180deg,#1f2937,#02030a)]" />
      <div className="absolute left-1/2 top-[39%] h-[4px] w-[32%] -translate-x-1/2 rounded-full bg-[linear-gradient(90deg,transparent,var(--operator-trim),transparent)] shadow-[0_0_18px_var(--operator-trim)]" />
      <div className={`absolute bottom-5 left-1/2 h-1 w-2/3 -translate-x-1/2 rounded-full bg-black/45 blur-sm ${pose === "pose-victor-profile" ? "scale-x-75" : ""}`} />
      <span className="sr-only">{presentation.fairnessNotice}</span>
    </div>
  );
}
