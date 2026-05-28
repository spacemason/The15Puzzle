import { useAuth } from "../auth";
import { api } from "../api";

export function ThemeToggle() {
  const { user, setUser } = useAuth();
  const current = user?.theme ?? "dark";
  const onClick = async () => {
    const next = current === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    if (user) {
      try {
        const { user: u } = await api.updateMe({ theme: next });
        setUser(u);
      } catch {
        document.documentElement.setAttribute("data-theme", current);
      }
    }
  };
  return (
    <button className="theme-toggle" onClick={onClick} title="Toggle theme" aria-label="Toggle theme">
      {current === "light" ? "🌙" : "☀️"}
    </button>
  );
}
