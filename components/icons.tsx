import React from "react";

/** 共用线性图标，18–20px，颜色继承 currentColor。 */

type IconProps = { className?: string; size?: number };

function Svg({ size = 20, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function IconOverview(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="3" width="7" height="7" rx="1.2" />
      <rect x="14" y="3" width="7" height="7" rx="1.2" />
      <rect x="3" y="14" width="7" height="7" rx="1.2" />
      <rect x="14" y="14" width="7" height="7" rx="1.2" />
    </Svg>
  );
}

export function IconBars(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 19V10" />
      <path d="M10 19V5" />
      <path d="M16 19V13" />
      <path d="M22 19H2" />
    </Svg>
  );
}

export function IconLayers(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="m3 14 9 5 9-5" />
      <path d="m3 10 9 5 9-5" />
    </Svg>
  );
}

export function IconGlobe(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18" />
      <path d="M12 3a14 14 0 0 0 0 18" />
    </Svg>
  );
}

export function IconWallet(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14.5" r="1" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconShield(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3 5 6v6c0 4.2 2.8 7.4 7 8.5 4.2-1.1 7-4.3 7-8.5V6l-7-3Z" />
    </Svg>
  );
}

export function IconClipboard(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="6" y="5" width="12" height="16" rx="2" />
      <path d="M9 5V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1" />
      <path d="M9 11h6" />
      <path d="M9 15h4" />
    </Svg>
  );
}

export function IconGear(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M4.9 6.5l1.6 1.6M17.5 16l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.9 17.5l1.6-1.6M17.5 8.1l1.6-1.6" />
    </Svg>
  );
}

export function IconDoc(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 3h7l5 5v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </Svg>
  );
}

export function IconBell(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 9a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9Z" />
      <path d="M10 21h4" />
    </Svg>
  );
}

export function IconChevronRight(p: IconProps) {
  return (
    <Svg {...p} size={p.size ?? 16}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  );
}

export function IconAlert(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 4 3 19h18L12 4Z" />
      <path d="M12 10v4" />
      <path d="M12 16.5h.01" />
    </Svg>
  );
}

export function IconClock(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6l4 2" />
    </Svg>
  );
}

export function IconBrandMark(p: IconProps) {
  return (
    <svg
      width={p.size ?? 28}
      height={p.size ?? 28}
      viewBox="0 0 32 32"
      className={p.className}
      aria-hidden
    >
      <rect width="32" height="32" rx="8" fill="#1D5FD1" />
      <path
        d="M8 18.5 16 8l8 10.5H8Z"
        fill="none"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M11 22h10" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export const NAV_ICONS: Record<string, React.FC<IconProps>> = {
  P00: IconOverview,
  INV: IconBars,
  P20: IconBars,
  P10: IconLayers,
  P30: IconGlobe,
  P40: IconWallet,
  P50: IconShield,
  P60: IconClipboard,
};

export const DOMAIN_ICONS: Record<string, React.FC<IconProps>> = {
  FA: IconBars,
  EQ: IconLayers,
  INTL: IconGlobe,
  CASH: IconWallet,
  RIGHTS: IconShield,
  ENG: IconClipboard,
};
