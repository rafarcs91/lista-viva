export default function Loading() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-line" />
      </header>
      <div className="scroll">
        <ul className="items" aria-busy="true" aria-label="Carregando a lista">
          {[1, 0.8, 0.6, 0.4, 0.25].map((opacity, i) => (
            <li key={i} className="skeleton skeleton-item" style={{ opacity }} />
          ))}
        </ul>
      </div>
    </div>
  );
}
