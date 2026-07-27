// Photo URLs come from Firebase getDownloadURL (https), but a customer can write
// arbitrary data to their own visit docs, so a crafted `javascript:` URL could
// become stored XSS when opened as an anchor href. Only allow http(s)/data:image
// URLs; anything else yields undefined (a non-clickable anchor).
export function safeUrl(url) {
  if (typeof url !== 'string') return undefined;
  const u = url.trim();
  if (/^https?:\/\//i.test(u) || /^data:image\//i.test(u)) return u;
  return undefined;
}
