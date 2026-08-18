export default function Loading() {
  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow" style={{ marginBottom: 5 }}>
            Lista Viva
          </p>
          <h1 className="title">Suas listas</h1>
        </div>
      </header>
      <div className="scroll">
        <div className="cards" aria-busy="true" aria-label="Carregando suas listas">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" style={{ opacity: 0.7 }} />
          <div className="skeleton skeleton-card" style={{ opacity: 0.4 }} />
        </div>
      </div>
    </div>
  );
}
