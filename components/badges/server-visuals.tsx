"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Crown, Flame, Medal, ShieldCheck, Sparkles, Star, Trophy, Zap } from "lucide-react";

import type { BadgeAnimationType, BadgeDisplaySize, ProfileFrameVisual, ReputationVisual, ServerThemeBannerVisual, VisualBadge } from "@/lib/badges/visuals";

type GlowStyle = CSSProperties & {
  "--dzn-badge-glow"?: string;
  "--dzn-frame-glow"?: string;
  "--dzn-theme-gradient"?: string;
  "--dzn-theme-image"?: string;
};

type BadgeIconProps = {
  badge: VisualBadge;
  size?: BadgeDisplaySize;
  showLabel?: boolean;
  locked?: boolean;
  className?: string;
};

export function BadgeIcon({ badge, size = badge.displaySize ?? "md", showLabel = false, locked = badge.locked, className = "" }: BadgeIconProps) {
  const label = `${badge.name}. ${badge.rarity} ${badge.category} badge. ${badge.description}`;
  return (
    <BadgeTooltip badge={badge}>
      <span
        className={`dzn-badge-chip dzn-badge-chip--${size} ${locked ? "dzn-badge-chip--locked" : ""} ${className}`}
        aria-label={label}
        title={label}
        tabIndex={0}
      >
        <AnimatedBadge badge={badge} locked={locked} size={size} />
        {showLabel ? <span className="dzn-badge-chip__label">{badge.name}</span> : null}
      </span>
    </BadgeTooltip>
  );
}

export function AnimatedBadge({ badge, locked = false, size = badge.displaySize ?? "md" }: { badge: VisualBadge; locked?: boolean; size?: BadgeDisplaySize }) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = !locked ? badge.animatedIconUrl || badge.staticIconUrl : badge.staticIconUrl;
  const shouldShowImage = Boolean(imageUrl && !imageFailed);
  const style: GlowStyle = {
    "--dzn-badge-glow": badge.glowColour,
  };

  return (
    <span
      className={[
        "dzn-badge-icon",
        `dzn-badge-icon--${size}`,
        `dzn-badge-icon--${badge.rarity}`,
        `dzn-badge-icon--anim-${locked ? "none" : badge.animationType}`,
        locked ? "dzn-badge-icon--locked" : "",
      ].join(" ")}
      style={style}
    >
      <span className="dzn-badge-icon__fallback">
        <BadgeFallbackIcon badge={badge} />
      </span>
      {shouldShowImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl ?? ""}
          alt={badge.imageAlt}
          loading="lazy"
          decoding="async"
          className="dzn-badge-icon__image"
          onError={() => setImageFailed(true)}
        />
      ) : null}
      <span className="dzn-badge-icon__shine" />
    </span>
  );
}

export function BadgeTooltip({ badge, children }: { badge: VisualBadge; children: ReactNode }) {
  return (
    <span className="dzn-badge-tooltip">
      {children}
      <span className="dzn-badge-tooltip__content" role="tooltip">
        <span className="dzn-badge-tooltip__title">{badge.name}</span>
        <span className="dzn-badge-tooltip__meta">{badge.rarity} / {badge.category}</span>
        <span className="dzn-badge-tooltip__copy">{badge.locked ? "Locked reward." : badge.description}</span>
      </span>
    </span>
  );
}

export function BadgeGrid({ badges, max, showLabels = true, emptyText = "Badges will appear here as this server earns them." }: { badges: VisualBadge[]; max?: number; showLabels?: boolean; emptyText?: string }) {
  const visible = typeof max === "number" ? badges.slice(0, max) : badges;
  if (!visible.length) return <p className="text-sm leading-6 text-zinc-400">{emptyText}</p>;
  return (
    <div className="dzn-badge-grid">
      {visible.map((badge) => (
        <BadgeIcon key={badge.code} badge={badge} showLabel={showLabels} locked={badge.locked} />
      ))}
    </div>
  );
}

export function BadgeShowcase({ badges, title = "Badge Showcase", emptyText }: { badges: VisualBadge[]; title?: string; emptyText?: string }) {
  const grouped = groupBadgesByCategory(badges);
  return (
    <section className="dzn-badge-showcase" aria-label={title}>
      <div className="dzn-badge-showcase__header">
        <Sparkles className="h-4 w-4 text-cyan-200" />
        <span>{title}</span>
      </div>
      {grouped.length ? (
        <div className="dzn-badge-showcase__groups">
          {grouped.map(([category, rows]) => (
            <div key={category} className="dzn-badge-showcase__group">
              <p className="dzn-badge-showcase__category">{formatBadgeCategory(category)}</p>
              <BadgeGrid badges={rows} showLabels max={8} />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm leading-6 text-zinc-400">{emptyText ?? "Badges will appear here as this server earns them."}</p>
      )}
    </section>
  );
}

export function ReputationBadge({ visual }: { visual: ReputationVisual }) {
  return (
    <BadgeIcon
      badge={{
        code: visual.key,
        name: visual.label,
        category: "reputation",
        description: `${visual.label} reputation tier.`,
        points: null,
        permanent: true,
        earnedAt: null,
        locked: false,
        ...visual,
      }}
      showLabel
    />
  );
}

export function CrownBadge({ badge }: { badge: VisualBadge }) {
  return <BadgeIcon badge={{ ...badge, category: "crown", animationType: normalizeAnimation(badge.animationType, "crown") }} showLabel />;
}

export function SeasonalBadge({ badge }: { badge: VisualBadge }) {
  return <BadgeIcon badge={{ ...badge, category: "seasonal", animationType: normalizeAnimation(badge.animationType, "seasonal") }} showLabel />;
}

export function PremiumBadge({ badge }: { badge: VisualBadge }) {
  return <BadgeIcon badge={{ ...badge, category: "premium", animationType: normalizeAnimation(badge.animationType, "premium") }} showLabel />;
}

export function ServerProfileFrame({ frame, children, compact = false, className = "" }: { frame: ProfileFrameVisual | null | undefined; children: ReactNode; compact?: boolean; className?: string }) {
  const [frameImageFailed, setFrameImageFailed] = useState(false);
  if (!frame) return <>{children}</>;
  const frameImageUrl = frame.isAnimated ? frame.animatedImageOverlayUrl || frame.imageOverlayUrl : frame.imageOverlayUrl;
  const style: GlowStyle = {
    "--dzn-frame-glow": frame.glowColour,
  };
  return (
    <span
      className={[
        "dzn-profile-frame",
        compact ? "dzn-profile-frame--compact" : "",
        `dzn-profile-frame--${frame.key}`,
        `dzn-profile-frame--anim-${frame.animationType}`,
        className,
      ].join(" ")}
      style={style}
      title={frame.description}
      aria-label={frame.label}
    >
      {children}
      {frameImageUrl && !frameImageFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={frameImageUrl}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          className="dzn-profile-frame__image"
          onError={() => setFrameImageFailed(true)}
        />
      ) : null}
    </span>
  );
}

export function ServerThemeBanner({ theme, children, overlay = false, className = "" }: { theme: ServerThemeBannerVisual | null | undefined; children?: ReactNode; overlay?: boolean; className?: string }) {
  if (!theme) return children ? <>{children}</> : null;
  const style: GlowStyle = {
    "--dzn-theme-gradient": theme.fallbackGradient,
    "--dzn-theme-image": theme.backgroundUrl ? `url("${theme.backgroundUrl}")` : "none",
  };
  if (overlay) {
    return (
      <span className={`dzn-theme-banner dzn-theme-banner--overlay dzn-theme-banner--${theme.key} ${className}`} style={style} aria-hidden="true">
        <span className="dzn-theme-banner__wash" />
      </span>
    );
  }
  return (
    <div className={`dzn-theme-banner dzn-theme-banner--block dzn-theme-banner--${theme.key} ${className}`} style={style}>
      <div className="dzn-theme-banner__wash" />
      <div className="dzn-theme-banner__content">{children}</div>
    </div>
  );
}

export function ServerCardBadges({ badges, max = 6, className = "" }: { badges: VisualBadge[] | null | undefined; max?: number; className?: string }) {
  const visible = (badges ?? []).filter((badge) => badge.isPublic).slice(0, max);
  if (!visible.length) return null;
  return (
    <div className={`dzn-server-card-badges ${className}`} aria-label="Server badge showcase">
      {visible.map((badge) => (
        <BadgeIcon key={badge.code} badge={badge} size="sm" />
      ))}
    </div>
  );
}

function iconForBadge(badge: VisualBadge) {
  if (badge.category === "crown" || badge.rarity === "crown") return "crown";
  if (badge.category === "seasonal" || badge.rarity === "seasonal") return "trophy";
  if (badge.category === "premium" || badge.rarity === "premium") return "sparkles";
  if (badge.category === "reputation") return "shield";
  if (badge.animationType === "flame") return "flame";
  if (badge.animationType === "electric") return "zap";
  if (badge.rarity === "legendary" || badge.rarity === "mythic" || badge.rarity === "limited") return "star";
  return "medal";
}

function BadgeFallbackIcon({ badge }: { badge: VisualBadge }) {
  const className = "h-[52%] w-[52%]";
  const icon = iconForBadge(badge);
  if (icon === "crown") return <Crown className={className} />;
  if (icon === "trophy") return <Trophy className={className} />;
  if (icon === "sparkles") return <Sparkles className={className} />;
  if (icon === "shield") return <ShieldCheck className={className} />;
  if (icon === "flame") return <Flame className={className} />;
  if (icon === "zap") return <Zap className={className} />;
  if (icon === "star") return <Star className={className} />;
  return <Medal className={className} />;
}

function groupBadgesByCategory(badges: VisualBadge[]) {
  const groups = new Map<string, VisualBadge[]>();
  for (const badge of badges) {
    const category = badge.category || "earned";
    groups.set(category, [...(groups.get(category) ?? []), badge]);
  }
  return Array.from(groups.entries()).map(([category, rows]) => [category, rows.sort((a, b) => b.sortOrder - a.sortOrder)] as const);
}

function formatBadgeCategory(category: string) {
  if (category === "pvp_pve") return "PvP / PvE";
  return category.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeAnimation(value: BadgeAnimationType, fallback: BadgeAnimationType) {
  return value === "none" ? fallback : value;
}
