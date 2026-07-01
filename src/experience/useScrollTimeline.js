// Wires Lenis smooth scroll into GSAP's ticker and keeps ScrollTrigger synced
// to it. Per-section choreography lives in each section's own ScrollTrigger
// (see Experience.jsx) — this hook only owns the Lenis/ticker lifecycle.
import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

// Returned so callers (e.g. the header's nav links) can drive Lenis directly
// via lenisRef.current.scrollTo(...) instead of a native scrollIntoView,
// which would fight Lenis's own virtual scroll position.
export function useLenisScroll() {
  const lenisRef = useRef(null);
  // Built eagerly during render (lazy ref init), not inside the useEffect
  // below — sibling/child components (TextScenes' magnetic-snap effect)
  // read lenisRef.current inside their OWN effects, and React runs child
  // effects before the parent's, so constructing Lenis inside this hook's
  // effect left lenisRef.current still null when those child effects ran,
  // silently no-op'ing through optional chaining. Building it during render
  // means it already exists by the time any effect — child or parent — runs.
  if (!lenisRef.current) {
    // Explicit duration/easing rather than Lenis's bare defaults — a longer
    // duration with an exponential ease-out reads as a heavier, more fluid
    // glide instead of the slightly twitchy default feel.
    lenisRef.current = new Lenis({
      smoothWheel: true,
      duration: 1.4,
      easing: (t) => Math.min(1, 1.001 - 2 ** (-10 * t)),
    });
  }

  useEffect(() => {
    const lenis = lenisRef.current;
    const onTick = (time) => lenis.raf(time * 1000);
    gsap.ticker.add(onTick);
    gsap.ticker.lagSmoothing(0);
    lenis.on('scroll', ScrollTrigger.update);

    return () => {
      gsap.ticker.remove(onTick);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  return lenisRef;
}
