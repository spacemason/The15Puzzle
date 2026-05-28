import { motion, AnimatePresence } from "framer-motion";

interface Props {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function GiveUpModal({ open, onCancel, onConfirm }: Props) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onCancel}
        >
          <motion.div
            className="modal"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Give up?</h3>
            <p style={{ margin: 0, color: "var(--fg-dim)" }}>
              I’ll solve it for you and play back the moves. This won’t count as a solved puzzle.
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={onCancel}>Keep trying</button>
              <button className="btn btn-danger" onClick={onConfirm}>Solve for me</button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
