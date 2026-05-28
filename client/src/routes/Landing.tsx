import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import type { LeaderboardEntry } from "@p15/shared";
import { api } from "../api";
import { useAuth } from "../auth";

function fmtTime(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function LandingPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { entries } = await api.leaderboard();
        if (alive) setEntries(entries);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="landing-grid">
      <aside className="card leaderboard">
        <h3>Leaderboard</h3>
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="empty-state">Be the first to solve a puzzle!</div>
        ) : (
          <ol>
            <AnimatePresence initial={false}>
              {entries.map((e, i) => (
                <motion.li
                  key={e.userId}
                  className={user && e.userId === user.id ? "you" : ""}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                >
                  <span className="rank">#{i + 1}</span>
                  <div>
                    <div style={{ fontWeight: 700 }}>{e.username}</div>
                    <div className="meta">
                      best {fmtTime(e.bestTimeMs)} ·{" "}
                      {e.avgAccuracy != null
                        ? `${Math.round(e.avgAccuracy * 100)}% acc`
                        : "—"}
                    </div>
                  </div>
                  <span className="count">{e.solveCount}</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        )}
      </aside>
      <section className="hero">
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          Slide the 15
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
        >
          A pile of randomly-generated puzzles is waiting for you.
        </motion.p>
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.25, type: "spring", stiffness: 220, damping: 16 }}
        >
          <Link to="/puzzles" className="btn btn-primary big-play">
            ▶ Play
          </Link>
        </motion.div>
      </section>
    </div>
  );
}
