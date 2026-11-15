/** A connected screen, as the system describes it (Electron's `screen.getAllDisplays()`). */
export interface ScreenInfo {
  /** The system's name for it: "Built-in Retina Display", "LG HDR 4K". Empty when it has none. */
  label: string;
  /** The computer's own screen (a laptop's). */
  internal: boolean;
  /** Its size in pixels. */
  width: number;
  height: number;
}

/** What Electron says of a display: the parts of `Electron.Display` read here. */
export interface ElectronDisplay {
  label?: string;
  internal?: boolean;
  size: { width: number; height: number };
  scaleFactor: number;
}

export function screenOf(display: ElectronDisplay): ScreenInfo {
  return {
    label: (display.label ?? '').trim(),
    internal: display.internal === true,
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor),
  };
}

/** How a screen is named: the system's name, or what it is when it has none. */
export function screenName(screen: ScreenInfo): string {
  if (screen.label) return screen.label;
  return screen.internal ? 'Built-in display' : `${screen.width}×${screen.height} display`;
}

/**
 * A screen setup, as a name that is also its key: the screens connected, by name, in order
 * ("Built-in Retina Display + LG HDR 4K"). Their names, not their sizes: a screen's resolution
 * can change (the system's scaled sizes) and it's still the same setup. Null when none is.
 */
export function setupOf(screens: ScreenInfo[]): string | null {
  if (screens.length === 0) return null;
  return screens
    .map(screenName)
    .sort((a, b) => a.localeCompare(b))
    .join(' + ');
}
