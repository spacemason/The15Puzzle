import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import type { PuzzleSummary } from "@p15/shared";
import { api } from "../api";

function difficultyPct(d: number): number {
  return Math.min(100, Math.round((d / 70) * 100));
}

function PuzzleCard({ p, idx }: { p: PuzzleSummary; idx: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.03 }}
      whileHover={{ y: -3 }}
    >
      <Link to={`/play/${p.id}`} className="puzzle-card" style={{ display: "flex" }}>
        <div className="name">{p.name}</div>
        <div className="sub">
          {p.builtIn ? "Built-in" : `by ${p.creatorName ?? "anon"}`} · scramble {p.difficulty} · optimal {p.optimalMoves}
        </div>
        <div className="diff" aria-hidden>
          <span style={{ width: `${difficultyPct(p.difficulty)}%` }} />
        </div>
        {p.solved ? <div className="badge" title="Solved">✓</div> : null}
      </Link>
    </motion.div>
  );
}

export function PuzzleListPage() {
  const [builtIns, setBuiltIns] = useState<PuzzleSummary[]>([]);
  const [community, setCommunity] = useState<PuzzleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const { builtIns, community } = await api.listPuzzles();
      setBuiltIns(builtIns);
      setCommunity(community);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const allBuiltInsSolved = builtIns.length > 0 && builtIns.every((p) => p.solved);

  if (loading) return <div className="empty-state">Generating puzzles…</div>;
  if (err) return <div className="empty-state">Something went wrong: {err}</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <div>
        <div className="section-title">
          <h2>Your 10 puzzles</h2>
          {allBuiltInsSolved ? (
            <button
              className="btn btn-primary"
              onClick={async () => {
                await api.regenerate();
                load();
              }}
            >
              Generate a fresh 10
            </button>
          ) : null}
        </div>
        <div className="puzzles-grid">
          {builtIns.map((p, i) => (
            <PuzzleCard key={p.id} p={p} idx={i} />
          ))}
        </div>
      </div>
      <div>
        <div className="section-title">
          <h2>Community puzzles</h2>
          <Link to="/create" className="btn">+ Create one</Link>
        </div>
        {community.length === 0 ? (
          <div className="empty-state">No community puzzles yet. Be the first!</div>
        ) : (
          <div className="puzzles-grid">
            {community.map((p, i) => (
              <PuzzleCard key={p.id} p={p} idx={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
