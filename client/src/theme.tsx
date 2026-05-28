import { useEffect } from "react";
import { useAuth } from "./auth";

// Apply the active user's theme to document.documentElement.
export function ThemeBinder() {
  const { user } = useAuth();
  useEffect(() => {
    const theme = user?.theme ?? "dark";
    document.documentElement.setAttribute("data-theme", theme);
  }, [user?.theme]);
  return null;
}
