// GSAP/Lenis wiring. Drives uProgress + the active state pair via direct uniform
// mutation from the scroll/RAF loop — never through React state, so the morph
// never causes a re-render (CLAUDE.md section 3: "Never trigger React re-renders
// inside useFrame", same rule applies here since this runs on every scroll tick).
import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

// onUpdate receives the overall scroll progress (0-1) across `scrollerSelector`.
// Callers derive section index / twirl amount / icon visibility from that single
// number — there's no per-segment state pair here, unlike a morph timeline.
export function useScrollTimeline({ scrollerSelector, onUpdate }) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    const scroller = document.querySelector(scrollerSelector);
    if (!scroller) return undefined;

    const lenis = new Lenis({ smoothWheel: true });
    const onTick = (time) => lenis.raf(time * 1000);
    gsap.ticker.add(onTick);
    gsap.ticker.lagSmoothing(0);
    lenis.on('scroll', ScrollTrigger.update);

    const trigger = ScrollTrigger.create({
      trigger: scroller,
      start: 'top top',
      end: 'bottom bottom',
      scrub: true,
      onUpdate: (self) => onUpdateRef.current?.(self.progress),
    });

    return () => {
      trigger.kill();
      gsap.ticker.remove(onTick);
      lenis.destroy();
    };
  }, [scrollerSelector]);
}
