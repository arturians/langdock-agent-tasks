"use client";

import { useEffect, useState } from "react";
import { parseUserId, USER_ID_STORAGE_KEY } from "@/lib/user-id";

export function UserIdentity({ disabled, onChange }: {
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const [userId, setUserId] = useState("");
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let active = true;
    // Initialize after hydration; discard initialization if the component unmounts.
    queueMicrotask(() => {
      if (!active) return;
      try {
        const id = parseUserId(localStorage.getItem(USER_ID_STORAGE_KEY)) ?? crypto.randomUUID();
        localStorage.setItem(USER_ID_STORAGE_KEY, id);
        setUserId(id);
        setDraft(id);
        onChange(id);
      } catch {
        setMessage("Cannot access local storage. Enable it and reload to use a persistent identity.");
      }
    });

    function handleStorage(event: StorageEvent) {
      if (event.key === USER_ID_STORAGE_KEY || event.key === null) {
        // Reload also cancels any stream belonging to the previous identity.
        window.location.reload();
      }
    }
    window.addEventListener("storage", handleStorage);
    return () => {
      active = false;
      window.removeEventListener("storage", handleStorage);
    };
  }, [onChange]);

  function selectIdentity(value: string) {
    const id = parseUserId(value);
    if (!id) {
      setMessage("Enter a valid UUID.");
      return;
    }
    try {
      localStorage.setItem(USER_ID_STORAGE_KEY, id);
      setUserId(id);
      setDraft(id);
      setMessage("User ID saved.");
      setEditing(false);
      onChange(id);
    } catch {
      setMessage("Could not save the user ID. Your current identity has not changed.");
    }
  }

  async function copyIdentity() {
    try {
      await navigator.clipboard.writeText(userId);
      setMessage("User ID copied.");
    } catch {
      setMessage("Could not copy. Use Change to select and copy the ID.");
    }
  }

  return (
    <section className="user-identity" aria-label="User identity">
      <div className="identity-summary">
        <button className="identity-id" type="button" disabled={!userId} onClick={copyIdentity} title={`${userId || "Loading user ID"} — click to copy`} aria-label="Copy user ID">
          <code>{userId || "Loading…"}</code>
        </button>
        <button type="button" disabled={disabled} aria-expanded={editing} aria-controls="identity-editor" onClick={() => {
          setDraft(userId);
          setMessage("");
          setEditing((value) => !value);
        }}>Change</button>
        <button type="button" disabled={disabled} onClick={() => selectIdentity(crypto.randomUUID())} title="Generate a new ID; previous tasks remain under the old ID">Reset</button>
      </div>
      {editing && (
        <form id="identity-editor" className="identity-editor" onSubmit={(event) => {
          event.preventDefault();
          if (!disabled) selectIdentity(draft);
        }} onKeyDown={(event) => {
          if (event.key === "Escape") { setEditing(false); setMessage(""); }
        }}>
          <label htmlFor="user-id">User ID</label>
          <input id="user-id" value={draft} onChange={(event) => setDraft(event.target.value)} disabled={disabled} spellCheck={false} autoComplete="off" autoFocus />
          <div className="identity-actions">
            <button type="submit" disabled={disabled}>Save</button>
            <button type="button" onClick={() => { setEditing(false); setMessage(""); }}>Cancel</button>
          </div>
          <p>Anyone with this ID can access its tasks. Save your current ID to return later.</p>
        </form>
      )}
      <div className="identity-message" role="status">{message}</div>
    </section>
  );
}
