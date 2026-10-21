import { useEffect, useRef, useState, useCallback } from "react";
import { fetchSearchSuggestions } from "../api.js";

export default function SearchBox({ onSearch, onSelectSuggestion, disabled }) {
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [hasQueried, setHasQueried] = useState(false);

  const timerRef = useRef(null);
  const abortControllerRef = useRef(null);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchSuggestions = useCallback(async (query) => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setIsOpen(false);
      setIsLoading(false);
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setHasQueried(true);

    try {
      const data = await fetchSearchSuggestions(trimmed, { signal: controller.signal });
      if (Array.isArray(data.items)) {
        setSuggestions(data.items);
        setIsOpen(true);
        setActiveIndex(-1);
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        setSuggestions([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    setValue(val);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    if (val.trim().length < 2) {
      setSuggestions([]);
      setIsOpen(false);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    timerRef.current = setTimeout(() => {
      fetchSuggestions(val);
    }, 300);
  };

  const handleSelect = (item) => {
    setIsOpen(false);
    setValue("");
    setActiveIndex(-1);
    if (onSelectSuggestion) {
      onSelectSuggestion(item);
    } else if (onSearch) {
      onSearch(item.title);
    }
  };

  const handleKeyDown = (e) => {
    if (!isOpen || suggestions.length === 0) {
      if (e.key === "Enter") {
        e.preventDefault();
        if (value.trim().length >= 2 && onSearch) {
          setIsOpen(false);
          onSearch(value.trim());
        }
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        handleSelect(suggestions[activeIndex]);
      } else if (value.trim().length >= 2 && onSearch) {
        setIsOpen(false);
        onSearch(value.trim());
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div className="search-box-wrapper" ref={containerRef}>
      <form
        className="search-box"
        onSubmit={(e) => {
          e.preventDefault();
          if (!disabled && value.trim().length >= 2 && onSearch) {
            setIsOpen(false);
            onSearch(value.trim());
          }
        }}
      >
        <input
          ref={inputRef}
          type="search"
          placeholder="Search movies, TV shows..."
          value={value}
          minLength={2}
          onChange={handleChange}
          onFocus={() => {
            if (suggestions.length > 0) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          aria-label="Search movies and series"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          disabled={disabled}
        />
        {isLoading && <span className="search-spinner" aria-hidden="true" />}
      </form>

      {isOpen && (
        <div className="search-suggestions-dropdown" role="listbox">
          {suggestions.length > 0 ? (
            suggestions.map((item, index) => (
              <div
                key={`${item.type}-${item.id}`}
                className={`suggestion-item ${index === activeIndex ? "active" : ""}`}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(item);
                }}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <div className="suggestion-poster-wrapper">
                  {item.poster ? (
                    <img
                      src={item.poster}
                      alt={item.title}
                      className="suggestion-poster"
                      loading="lazy"
                    />
                  ) : (
                    <div className="suggestion-poster-placeholder">🎬</div>
                  )}
                </div>
                <div className="suggestion-info">
                  <div className="suggestion-title-row">
                    <span className="suggestion-title">{item.title}</span>
                    {item.year && <span className="suggestion-year">({item.year})</span>}
                  </div>
                  <div className="suggestion-meta">
                    <span className="suggestion-badge badge-type">
                      {item.type === "series" ? "TV Series" : "Movie"}
                    </span>
                    {item.rating ? (
                      <span className="suggestion-badge badge-rating">★ {Number(item.rating).toFixed(1)}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          ) : hasQueried && !isLoading ? (
            <div className="suggestion-empty">No matching titles found on TMDB</div>
          ) : null}
        </div>
      )}
    </div>
  );
}
