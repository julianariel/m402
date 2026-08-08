import type { CSSProperties, HTMLAttributes } from 'react';
import { ICON_DATA } from '../../design-system/icons';

export interface IconProps extends HTMLAttributes<HTMLSpanElement> {
  /** Lucide icon name, e.g. "shield-check". */
  name: string;
  /** Square size in px. Default 16. */
  size?: number;
  /** Any CSS color. Default "currentColor". */
  color?: string;
  /** Continuous rotation, for loader-circle. */
  spin?: boolean;
  style?: CSSProperties;
}

const CDN_BASE = 'https://unpkg.com/lucide-static@0.475.0/icons/';

function resolve(name: string): string {
  return ICON_DATA[name] ?? CDN_BASE + name + '.svg';
}

/** Monochrome Lucide glyph, masked so it always takes currentColor. */
export function Icon({ name, size = 16, color = 'currentColor', spin = false, style, ...rest }: IconProps) {
  const url = resolve(name);
  return (
    <span
      aria-hidden="true"
      {...rest}
      style={{
        display: 'inline-block', flex: '0 0 auto', width: size, height: size,
        background: color,
        WebkitMaskImage: 'url("' + url + '")', maskImage: 'url("' + url + '")',
        WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center', maskPosition: 'center',
        WebkitMaskSize: 'contain', maskSize: 'contain',
        animation: spin ? 'm402-spin 900ms linear infinite' : undefined,
        ...style,
      }}
    />
  );
}
