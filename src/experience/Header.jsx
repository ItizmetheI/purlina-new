// Persistent header rendered once at the Experience root (not per-section,
// unlike the old intro-only logo div) — a fixed wordmark + anchor nav that
// smooth-scrolls to each sector section via the shared Lenis instance.
import scrollScript from '../content/scroll-script.json';

const SECTOR_SCENES = scrollScript.scenes.filter((scene) => scene.sector);

export default function Header({ lenisRef, activeSection }) {
  const handleNavClick = (event, id) => {
    event.preventDefault();
    lenisRef.current?.scrollTo(`#${id}`, { duration: 1.2 });
  };

  return (
    <header className="experience__header">
      <span className="experience__wordmark">PURLINA MATRIX</span>
      <nav className="experience__nav" aria-label="Sektörler">
        {SECTOR_SCENES.map((scene) => (
          <a
            key={scene.id}
            href={`#${scene.id}`}
            className={scene.id === activeSection ? 'experience__nav-link--active' : undefined}
            onClick={(event) => handleNavClick(event, scene.id)}
          >
            {scene.heading}
          </a>
        ))}
      </nav>
    </header>
  );
}
