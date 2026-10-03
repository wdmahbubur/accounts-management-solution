"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";

type InvoiceTab = "all" | "drafts" | "awaiting_approval" | "posted";
type SavedFilter = { id: string; name: string; tab: InvoiceTab; search: string };
const tabs: InvoiceTab[] = ["all", "drafts", "awaiting_approval", "posted"];

function hasUnsavedForm(excluded?: HTMLFormElement | null): boolean {
  return Array.from(document.forms).some((form) => {
    if (form === excluded || form.dataset.unsaved === "false") return false;
    return Array.from(form.elements).some((element) => {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return false;
      if (element instanceof HTMLInputElement && ["button", "submit", "reset", "hidden"].includes(element.type)) return false;
      if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) return element.checked !== element.defaultChecked;
      if (element instanceof HTMLSelectElement) return Array.from(element.options).some((option) => option.selected !== option.defaultSelected);
      return element.value !== element.defaultValue;
    });
  });
}

export function InvoiceFilters({ organizationId, userId, tab, search }: {
  organizationId: string; userId: string; tab: InvoiceTab; search: string;
}) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState<SavedFilter[]>([]);
  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const base = `/o/${organizationId}/sales/invoices`;
  const storageKey = `ams:invoice-filters:v1:${encodeURIComponent(userId)}:${encodeURIComponent(organizationId)}`;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const raw = localStorage.getItem(storageKey);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) setSaved(parsed.filter((item): item is SavedFilter => item && typeof item.id === "string" && typeof item.name === "string" && typeof item.search === "string" && tabs.includes(item.tab)));
      } catch { setSaved([]); }
    });
    return () => cancelAnimationFrame(frame);
  }, [storageKey]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.key !== "/") return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, select, textarea, [contenteditable='true'], [role='textbox']"))) return;
      if (hasUnsavedForm()) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function persist(next: SavedFilter[]) {
    setSaved(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Keep the current page usable if storage is unavailable. */ }
  }

  function saveFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim().slice(0, 40);
    if (!cleanName) return;
    const filter = { id: crypto.randomUUID(), name: cleanName, tab, search };
    persist([...saved.filter((item) => item.name.toLocaleLowerCase() !== cleanName.toLocaleLowerCase()), filter]);
    setSelectedId(filter.id);
    setName("");
  }

  function applyFilter(event: ChangeEvent<HTMLSelectElement>) {
    const id = event.currentTarget.value;
    setSelectedId(id);
    const filter = saved.find((item) => item.id === id);
    if (!filter) return;
    const query = new URLSearchParams({ tab: filter.tab });
    if (filter.search) query.set("search", filter.search);
    router.push(`${base}?${query.toString()}`);
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Escape" || hasUnsavedForm(event.currentTarget.form)) return;
    event.currentTarget.value = "";
    event.currentTarget.form?.requestSubmit();
  }

  return <>
    <form className="panel toolbar" action={base} method="get">
      <input type="hidden" name="tab" value={tab}/>
      <label>Search invoices<input ref={searchRef} onKeyDown={onSearchKeyDown} type="search" name="search" maxLength={100} defaultValue={search} placeholder="Number, customer or reference" aria-keyshortcuts="/"/></label>
      <button type="submit">Search</button>{search && <Link className="secondary" href={`${base}?tab=${tab}`}>Clear</Link>}
      <label>Saved filters<select value={selectedId} onChange={applyFilter}><option value="">Choose saved filter</option>{saved.map((filter) => <option key={filter.id} value={filter.id}>{filter.name}</option>)}</select></label>
      {selectedId && <button type="button" className="secondary" onClick={() => persist(saved.filter((filter) => filter.id !== selectedId))}>Delete saved filter</button>}
      <span className="muted">Press / to focus search; Esc clears it.</span>
    </form>
    <form className="toolbar" onSubmit={saveFilter}>
      <label>Save current filters as<input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder="e.g. Posted invoices"/></label>
      <button type="submit" disabled={!name.trim()}>Save filter</button>
    </form>
  </>;
}
