import { useEffect, useRef, useState } from "react";

export default function SearchBox({ onSearch, disabled }) {
  const [value, setValue] = useState("");
  const [state, setState] = useState("idle");
  const timerRef = useRef(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    setValue(val);
    if (val.trim().length < 2) {
      setState("idle");
      return;
    }
    setState("loading");
    timerRef.current = setTimeout(() => {
      onSearch(val);
      setState("idle");
    }, 400);
  };

  return (
    <form
      className="search-box"
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled && value.trim().length >= 2) {
          onSearch(value);
        }
      }}
    >
      <input
        type="search"
        placeholder="Search movies and series"
        value={value}
        minLength={2}
        onChange={handleChange}
        aria-label="Search movies and series"
      />
      {state === "loading" && <span className="search-spinner" aria-hidden="true" />}
    </form>
  );
}
