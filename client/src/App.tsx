import { useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { hub } from "./hub/hub";
import { Header } from "./components/Header";
import { DailyPlay } from "./routes/DailyPlay";
import { ThemeBinder } from "./theme";
import { useAuth } from "./auth";
import { RequireAuth } from "./components/RequireAuth";
import { LoginPage } from "./routes/Login";
import { SignupPage } from "./routes/Signup";
import { LandingPage } from "./routes/Landing";
import { PuzzleListPage } from "./routes/PuzzleList";
import { PlayPage } from "./routes/Play";
import { CreatePage } from "./routes/Create";

export function App() {
  const { user, loading } = useAuth();
  const nav = useNavigate();

  // Gamepad menu navigation (once for the whole app): while a gamepad is the
  // active device and any `.btn` is visible, the d-pad/stick moves a highlight
  // across buttons and A clicks the focused one. Re-queried every frame, so it
  // follows React re-renders and route changes — covering every menu/dialog
  // button (landing, puzzle list, login/signup, create, give-up modal,
  // play-side actions). No-op for mouse/touch/keyboard; doesn't touch gameplay
  // (the puzzle board uses the d-pad to slide tiles via its own input group).
  useEffect(() => {
    hub.input.autoNavigate(".btn");
    // Daily challenges: a clicked date in the hub menu (or a /the15puzzle/?daily=DATE
    // deep link) starts a seeded daily board. ensureGuest first so the completion
    // can't 401; play() just routes to the self-contained /daily screen, which
    // reads the active challenge's seed. No 15-puzzle account needed for a daily.
    void hub.ensureGuest().catch(() => {}).then(() => {
      hub.daily.define({ play: () => nav("/daily") });
    });
  }, [nav]);

  return (
    <div className="app-shell">
      <ThemeBinder />
      <Header />
      <main className="app-main">
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : (
          <Routes>
            <Route
              path="/"
              element={user ? <LandingPage /> : <Navigate to="/signup" replace />}
            />
            <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
            <Route path="/signup" element={user ? <Navigate to="/" replace /> : <SignupPage />} />
            <Route
              path="/puzzles"
              element={
                <RequireAuth>
                  <PuzzleListPage />
                </RequireAuth>
              }
            />
            <Route
              path="/play/:id"
              element={
                <RequireAuth>
                  <PlayPage />
                </RequireAuth>
              }
            />
            <Route
              path="/create"
              element={
                <RequireAuth>
                  <CreatePage />
                </RequireAuth>
              }
            />
            <Route path="/daily" element={<DailyPlay />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
    </div>
  );
}
