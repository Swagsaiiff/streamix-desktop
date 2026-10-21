import SearchBox from "./SearchBox.jsx";

export default function Navbar({ view, onNavigate, onSearch, onSelectSuggestion, searchState }) {
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
        <button className={view === "settings" ? "nav-link active" : "nav-link"} onClick={() => onNavigate("settings")}>
          Settings
        </button>
      </nav>
      <SearchBox
        onSearch={onSearch}
        onSelectSuggestion={onSelectSuggestion}
        disabled={searchState === "loading"}
      />
    </header>
  );
}
