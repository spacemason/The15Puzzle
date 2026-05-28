import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import type { PuzzleStyle } from "@p15/shared";
import { api } from "../api";

const PATTERNS: PuzzleStyle["pattern"][] = ["none", "dots", "grid", "diagonal"];

function FileField({
  label,
  file,
  onChange,
}: {
  label: string;
  file: File | null;
  onChange: (f: File | null) => void;
}) {
  return (
    <label className={`uploader ${file ? "has-file" : ""}`}>
      <span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
      <input
        type="file"
        accept="image/*"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      {file ? (
        <span style={{ fontSize: 12, color: "var(--fg-dim)" }}>{file.name}</span>
      ) : (
        <span style={{ fontSize: 12, color: "var(--fg-dim)" }}>Optional</span>
      )}
    </label>
  );
}

export function CreatePage() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [difficulty, setDifficulty] = useState(25);
  const [showNumbers, setShowNumbers] = useState(true);
  const [bgFile, setBgFile] = useState<File | null>(null);
  const [completeFile, setCompleteFile] = useState<File | null>(null);
  const [tileFiles, setTileFiles] = useState<(File | null)[]>(Array(15).fill(null));
  const [style, setStyle] = useState<PuzzleStyle>({
    bgColor: "",
    boardColor: "",
    tileColor: "",
    tileBorderColor: "",
    tileTextColor: "",
    pattern: "none",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("name", name || `Custom by you`);
      fd.set("difficulty", String(difficulty));
      fd.set("showNumbers", showNumbers ? "true" : "false");
      // Trim empty style values
      const cleanStyle: PuzzleStyle = {};
      for (const k of Object.keys(style) as (keyof PuzzleStyle)[]) {
        const v = style[k];
        if (v != null && v !== "") (cleanStyle as any)[k] = v;
      }
      fd.set("style", JSON.stringify(cleanStyle));
      if (bgFile) fd.set("bgImage", bgFile);
      if (completeFile) fd.set("completeImage", completeFile);
      tileFiles.forEach((f, i) => {
        if (f) fd.set(`tileImage${i}`, f);
      });
      const { id } = await api.createPuzzle(fd);
      nav(`/play/${id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.form
      className="community-creator-form"
      onSubmit={submit}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="section-title"><h2>Create a custom puzzle</h2></div>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="field-row">
          <div className="field">
            <label style={{ fontSize: 13, color: "var(--fg-dim)" }}>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My masterpiece" />
          </div>
          <div className="field">
            <label style={{ fontSize: 13, color: "var(--fg-dim)" }}>Difficulty (scramble moves): {difficulty}</label>
            <input
              type="range"
              min={6}
              max={70}
              value={difficulty}
              onChange={(e) => setDifficulty(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="toggle-row">
          <span style={{ fontSize: 13, color: "var(--fg-dim)" }}>Show numbers on tiles</span>
          <div
            className={`toggle ${showNumbers ? "on" : ""}`}
            onClick={() => setShowNumbers((s) => !s)}
            role="button"
            tabIndex={0}
          />
        </div>
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <strong>Images (optional)</strong>
        <div className="field-row">
          <FileField label="Background image" file={bgFile} onChange={setBgFile} />
          <FileField label="Complete-puzzle image (slices into tiles)" file={completeFile} onChange={setCompleteFile} />
        </div>
        <div>
          <strong style={{ fontSize: 13 }}>Per-tile images (tiles 1–15)</strong>
          <div className="tile-uploads" style={{ marginTop: 8 }}>
            {tileFiles.map((f, i) => (
              <FileField
                key={i}
                label={`#${i + 1}`}
                file={f}
                onChange={(nf) => {
                  const arr = tileFiles.slice();
                  arr[i] = nf;
                  setTileFiles(arr);
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <strong>Colors & style (used when images aren’t set)</strong>
        <div className="field-row">
          <ColorField label="Board background" value={style.boardColor ?? ""} onChange={(v) => setStyle((s) => ({ ...s, boardColor: v }))} />
          <ColorField label="Tile color" value={style.tileColor ?? ""} onChange={(v) => setStyle((s) => ({ ...s, tileColor: v }))} />
        </div>
        <div className="field-row">
          <ColorField label="Tile border" value={style.tileBorderColor ?? ""} onChange={(v) => setStyle((s) => ({ ...s, tileBorderColor: v }))} />
          <ColorField label="Tile text" value={style.tileTextColor ?? ""} onChange={(v) => setStyle((s) => ({ ...s, tileTextColor: v }))} />
        </div>
        <div className="field-row">
          <div className="field">
            <label style={{ fontSize: 13, color: "var(--fg-dim)" }}>Pattern</label>
            <select
              value={style.pattern ?? "none"}
              onChange={(e) =>
                setStyle((s) => ({ ...s, pattern: e.target.value as PuzzleStyle["pattern"] }))
              }
            >
              {PATTERNS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {err ? <div style={{ color: "var(--bad)" }}>{err}</div> : null}

      <div style={{ display: "flex", gap: 12 }}>
        <button className="btn" type="button" onClick={() => nav(-1)}>
          Cancel
        </button>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create & play"}
        </button>
      </div>
    </motion.form>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="field">
      <label style={{ fontSize: 13, color: "var(--fg-dim)" }}>{label}</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="color"
          value={value || "#7c5cff"}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 42, height: 38, padding: 0, border: "1px solid var(--border)", borderRadius: 8 }}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="auto"
          style={{ flex: 1 }}
        />
      </div>
    </div>
  );
}
