/* Thin same-origin fetch wrapper for this site's own Netlify Functions. */
const API_BASE = '/.netlify/functions';

async function apiGet(fn, params) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    const res = await fetch(`${API_BASE}/${fn}${qs}`);
    if (!res.ok) throw new Error(`${fn} failed: ${res.status}`);
    return res.json();
}
