// Build previews with WEBSITE_NOINDEX=true, independently of their canonical origin.
export const indexable = import.meta.env.PROD && import.meta.env.WEBSITE_NOINDEX !== 'true';
