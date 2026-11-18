import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './runtime.js';

// The category (Men's / Ladies / Kids) the console is managing. Lists, new teams, new fixtures and
// imports all use it; the choice is remembered on this device. Scoring a match does not depend
// on it: a match always belongs to its own category.

const KEY = 'cricket.admin.category';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (v) => { try { localStorage.setItem(KEY, v); } catch { /* storage unavailable */ } };

const Ctx = createContext(null);

export function CategoryProvider({ children }) {
  const [categories, setCategories] = useState(null);
  const [key, setKey] = useState(() => read() || 'mens');
  useEffect(() => {
    api.get('/categories').then((d) => setCategories(d.categories)).catch(() => setCategories([]));
  }, []);
  const select = (k) => { setKey(k); write(k); };
  const category = categories?.find((c) => c.key === key) || categories?.[0] || null;
  const value = {
    categories: categories || [],
    category,
    key: category?.key || key,
    select,
    /** API path for the selected category: scoped('/teams') → '/teams?category=ladies'. */
    scoped: (p) => `${p}${p.includes('?') ? '&' : '?'}category=${category?.key || key}`,
    nameOf: (id) => categories?.find((c) => c.id === id)?.name || '',
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useCategory = () => useContext(Ctx);

/** Men's / Ladies / Kids selector for the console header. */
export function CategorySelect() {
  const { categories, key, select } = useCategory();
  if (!categories.length) return null;
  return (
    <div className="flex rounded-lg bg-white/10 p-0.5" role="tablist" aria-label="Category">
      {categories.map((c) => (
        <button key={c.key} type="button" role="tab" aria-selected={c.key === key} onClick={() => select(c.key)}
          className={`rounded-md px-2.5 py-1 text-xs font-semibold ${c.key === key ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white'}`}>
          {c.name}
        </button>
      ))}
    </div>
  );
}
