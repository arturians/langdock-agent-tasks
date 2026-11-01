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
      setMessage("Could not copy. Select and copy the ID from the input.");
    }
  }

  return (
    <section className="user-identity" aria-label="User identity">
      <label htmlFor="user-id">User ID</label>
      <input id="user-id" value={draft} onChange={(event) => setDraft(event.target.value)} disabled={disabled} spellCheck={false} autoComplete="off" />
      <div className="identity-actions">
        <button type="button" disabled={disabled} onClick={() => selectIdentity(draft)}>Use ID</button>
        <button type="button" disabled={!userId} onClick={copyIdentity}>Copy ID</button>
        <button type="button" disabled={disabled} onClick={() => selectIdentity(crypto.randomUUID())}>New ID</button>
      </div>
      <p>Anyone with this ID can access its tasks. A new ID keeps previous tasks under the old ID. Save it to return later.</p>
      {disabled && <p>Wait for the current run to finish before switching identity.</p>}
      <p role="status">{message}</p>
    </section>
  );
}
