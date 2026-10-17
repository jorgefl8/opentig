import { createFromSource } from 'fumadocs-core/search/server';
import { source } from '@/lib/docs-source';

// Astro prerenders the index as a file; queries run entirely in the browser.
export const prerender = true;
export const { staticGET: GET } = createFromSource(source);
