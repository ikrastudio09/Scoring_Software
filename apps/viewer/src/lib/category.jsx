import { createContext, useContext, useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { api } from './runtime.js';

// Men's / Ladies / Kids. Every page below /:cat/ shows ONE category's data: links are built with
// path() and API requests with scoped(), so the category can never be lost or mixed.

export const CATEGORY_KEYS = ['mens', 'ladies', 'kids'];
const FALLBACK = [
  { key: 'mens', name: "Men's", shortName: 'Men' },
  { key: 'ladies', name: 'Ladies', shortName: 'Ladies' },
  { key: 'kids', name: 'Kids', shortName: 'Kids' },
];
const LAST_KEY = 'category.last';
const LIST_KEY = 'categories.v1';

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

export const lastCategory = () => (CATEGORY_KEYS.includes(read(LAST_KEY)) ? read(LAST_KEY) : null);

/** Category list (id, key, name), cached locally so navigation renders instantly and offline. */
export function useCategories() {
  const [list, setList] = useState(() => {
    try { return JSON.parse(read(LIST_KEY)) || FALLBACK; } catch { return FALLBACK; }
  });
  useEffect(() => {
    api.get('/categories').then(({ categories }) => { setList(categories); write(LIST_KEY, JSON.stringify(categories)); }).catch(() => {});
  }, []);
  return list;
}

const Ctx = createContext(null);

/** Route element for /:cat — validates the key, remembers it and provides the category. */
export function CategoryScope() {
  const { cat } = useParams();
  const categories = useCategories();
  const valid = CATEGORY_KEYS.includes(cat);
  useEffect(() => { if (valid) write(LAST_KEY, cat); }, [cat, valid]);
  if (!valid) return <Navigate to="/" replace />;
  const category = categories.find((c) => c.key === cat) || FALLBACK.find((c) => c.key === cat);
  const value = {
    key: cat,
    category,
    categories,
    /** Link inside this category: path('/matches') → '/ladies/matches'. */
    path: (p = '') => `/${cat}${p}`,
    /** API path for this category: scoped('/home') → '/home?category=ladies'. */
    scoped: (p) => `${p}${p.includes('?') ? '&' : '?'}category=${cat}`,
  };
  return <Ctx.Provider value={value}><Outlet /></Ctx.Provider>;
}

export const useCategory = () => useContext(Ctx);

/**
 * A link inside a category: <CatLink to="/players/1"> → /ladies/players/1 on a Ladies page.
 * `cat` overrides the category (lists that show several categories, e.g. the landing page).
 */
export function CatLink({ to, cat, ...rest }) {
  const ctx = useContext(Ctx);
  const key = cat || ctx?.key || lastCategory() || 'mens';
  return <Link to={`/${key}${to}`} {...rest} />;
}

/** Old links without a category (/matches/123, installed apps, shared links) → remembered category. */
export function LegacyRedirect() {
  const { pathname, search } = useLocation();
  return <Navigate to={`/${lastCategory() || 'mens'}${pathname}${search}`} replace />;
}

/**
 * An entity page opened under the wrong category (e.g. a Ladies match at /mens/matches/:id):
 * move to the right category so navigation and data stay consistent.
 */
export function useCategoryGuard(categoryId) {
  const ctx = useCategory();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  useEffect(() => {
    if (!ctx || !categoryId || ctx.category?.id === undefined || ctx.category.id === categoryId) return;
    const right = ctx.categories.find((c) => c.id === categoryId);
    if (right) navigate(pathname.replace(/^\/[^/]+/, `/${right.key}`) + search, { replace: true });
  }, [ctx, categoryId, pathname, search, navigate]);
}
