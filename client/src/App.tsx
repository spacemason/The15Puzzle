import { Routes, Route, Navigate } from "react-router-dom";
import { Header } from "./components/Header";
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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
    </div>
  );
}
