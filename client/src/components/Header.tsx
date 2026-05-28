import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { ThemeToggle } from "./ThemeToggle";

export function Header() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  return (
    <header className="app-header">
      <Link to="/" className="brand">The 15 Puzzle</Link>
      <div className="controls">
        {user ? (
          <>
            <span style={{ color: "var(--fg-dim)", fontSize: 14 }}>
              Hi, <strong style={{ color: "var(--fg)" }}>{user.username}</strong>
            </span>
            <Link to="/create" className="btn btn-ghost">+ Create</Link>
            <button
              className="btn btn-ghost"
              onClick={async () => {
                await logout();
                nav("/login");
              }}
            >
              Log out
            </button>
          </>
        ) : null}
        <ThemeToggle />
      </div>
    </header>
  );
}
