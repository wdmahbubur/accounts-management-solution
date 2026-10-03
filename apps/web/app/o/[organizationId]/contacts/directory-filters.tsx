"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";

type Status = "active" | "inactive" | "overdue" | "all";
type SavedFilter = { id: string; name: string; search: string; status: Status };

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || Boolean(target.closest("input, select, textarea, [contenteditable='true'], [role='textbox']"));
}

function hasUnsavedForm(excludedForm?: HTMLFormElement | null): boolean {
  return Array.from(document.forms).some((form) => {
    if (form === excludedForm) return false;
    if (form.dataset.unsaved === "false") return false;
    return Array.from(form.elements).some((element) => {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return false;
      if (element instanceof HTMLInputElement && ["button", "submit", "reset", "hidden"].includes(element.type)) return false;
      if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) return element.checked !== element.defaultChecked;
      if (element instanceof HTMLSelectElement) return Array.from(element.options).some((option) => option.selected !== option.defaultSelected);
      return element.value !== element.defaultValue;
    });
  });
}

export function DirectoryFilters({ scope, base, search, status, userId, organizationId }: {
  scope: "customer" | "vendor"; base: string; search: string; status: Status; userId: string; organizationId: string;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [saved, setSaved] = useState<SavedFilter[]>([]);
  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const storageKey = `ams:contact-filters:v1:${encodeURIComponent(userId)}:${encodeURIComponent(organizationId)}:${scope}`;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const raw = localStorage.getItem(storageKey);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) setSaved(parsed.filter((item): item is SavedFilter => item && typeof item.id === "string" && typeof item.name === "string" && typeof item.search === "string" && ["active", "inactive", "overdue", "all"].includes(item.status)));
      } catch { setSaved([]); }
    });
    return () => cancelAnimationFrame(frame);
  }, [storageKey]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.key !== "/") return;
      if (isEditableTarget(event.target) || hasUnsavedForm()) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function persist(next: SavedFilter[]) {
    setSaved(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Saved filters remain available for this page session. */ }
  }

  function saveFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim().slice(0, 40);
    if (!cleanName) return;
    const filter = { id: crypto.randomUUID(), name: cleanName, search, status };
    persist([...saved.filter((item) => item.name.toLocaleLowerCase() !== cleanName.toLocaleLowerCase()), filter]);
    setSelectedId(filter.id);
    setName("");
  }

  function applyFilter(event: ChangeEvent<HTMLSelectElement>) {
    const filter = saved.find((item) => item.id === event.currentTarget.value);
    setSelectedId(event.currentTarget.value);
    if (!filter) return;
    const query = new URLSearchParams({ status: filter.status });
    if (filter.search) query.set("search", filter.search);
    router.push(`${base}?${query.toString()}`);
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (hasUnsavedForm(event.currentTarget.form)) return;
      event.currentTarget.value = "";
      event.currentTarget.form?.requestSubmit();
    }
  }

  return <>
    <form className="toolbar" action={base} method="get">
      <label>Search contacts<input ref={searchRef} onKeyDown={onSearchKeyDown} type="search" name="search" maxLength={100} defaultValue={search} placeholder="Name, email, or phone" aria-keyshortcuts="/"/></label>
      <label>Status<select name="status" defaultValue={status}><option value="active">Active</option><option value="overdue">Overdue</option><option value="inactive">Archived</option><option value="all">All</option></select></label>
      <button type="submit">Search</button>{(search||status!=="active")&&<Link className="secondary" href={base}>Clear filters</Link>}
      <label>Saved filters<select value={selectedId} onChange={applyFilter}><option value="">Choose saved filter</option>{saved.map((filter)=><option key={filter.id} value={filter.id}>{filter.name}</option>)}</select></label>
      {selectedId&&<button type="button" className="secondary" onClick={()=>persist(saved.filter((filter)=>filter.id!==selectedId))}>Delete saved filter</button>}
      <span className="muted">Press / to focus search; Esc clears it.</span>
    </form>
    <form className="toolbar" onSubmit={saveFilter}>
      <label>Save current filters as<input value={name} onChange={(event)=>setName(event.target.value)} maxLength={40} placeholder="e.g. Overdue customers"/></label>
      <button type="submit" disabled={!name.trim()}>Save filter</button>
    </form>
  </>;
}
