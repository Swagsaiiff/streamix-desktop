import SearchBox from "./SearchBox.jsx";

export default function Navbar({ view, onNavigate, onSearch, searchState }) {
  return (
    <header className="navbar">
      <button className="brand-btn" onClick={() => onNavigate("home")}>
        STREAMIX
      </button>
      <nav className="nav-links">
        <button className={view === "home" ? "nav-link active" : "nav-link"} onClick={() => onNavigate("home")}>
          Home
        </button>
        <button className={view === "movies" ? "nav-link active" : "nav-link"} onClick={() => onNavigate("movies")}>
          Movies
        </button>
        <button className={view === "series" ? "nav-link active" : "nav-link"} onClick={() => onNavigate("series")}>
          Series
        </button>
      </nav>
      <SearchBox onSearch={onSearch} disabled={searchState === "loading"} />
    </header>
  );
}
