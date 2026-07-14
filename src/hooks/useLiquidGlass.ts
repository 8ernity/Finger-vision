import { useEffect, useRef } from 'react';
import { liquidGlass, LiquidGlassOptions } from '../lib/liquid-glass';

export function useLiquidGlass<T extends HTMLElement = HTMLDivElement>(
  enabled = true,
  options: LiquidGlassOptions = {}
) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (enabled && ref.current) {
      const glass = liquidGlass(ref.current, {
        scale: -150,    // Stronger refraction
        chroma: 10,     // More color splitting (chromatic aberration)
        mapBlur: 24,    // Smoother glass surface
        blur: 0,        // 0 frosted blur for perfect clarity
        saturate: 1.8,  // Boost colors behind it
        ...options
      });
      return () => {
        if (glass && glass.destroy) glass.destroy();
      };
    }
  }, [enabled, JSON.stringify(options)]);

  return ref;
}
