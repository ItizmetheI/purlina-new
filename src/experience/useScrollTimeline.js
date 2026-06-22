// Wires Lenis smooth scroll into GSAP's ticker and keeps ScrollTrigger synced
// to it. Per-section choreography lives in each section's own ScrollTrigger
// (see Experience.jsx) — this hook only owns the Lenis/ticker lifecycle.
import { useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

export function useLenisScroll() {
  useEffect(() => {
    const lenis = new Lenis({ smoothWheel: true });
    const onTick = (time) => lenis.raf(time * 1000);
    gsap.ticker.add(onTick);
    gsap.ticker.lagSmoothing(0);
    lenis.on('scroll', ScrollTrigger.update);

    return () => {
      gsap.ticker.remove(onTick);
      lenis.destroy();
    };
  }, []);
}
