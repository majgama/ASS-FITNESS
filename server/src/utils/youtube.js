const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);

// Accepts a YouTube link, an embed URL or the full <iframe> snippet copied from YouTube.
export function extractYoutubeVideoId(input) {
  if (typeof input !== 'string') return null;
  let value = input.trim();
  if (!value) return null;

  const iframeSrc = value.match(/<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i);
  if (iframeSrc) value = iframeSrc[1].replace(/&amp;/g, '&');
  else if (/^</.test(value)) return null;

  if (videoIdPattern.test(value)) return value;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;

  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.toLowerCase();
  let candidate = null;
  if (host === 'youtu.be') {
    candidate = url.pathname.split('/').filter(Boolean)[0];
  } else if (youtubeHosts.has(host)) {
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] === 'watch') candidate = url.searchParams.get('v');
    else if (['embed', 'shorts', 'live', 'v'].includes(segments[0])) candidate = segments[1];
  }

  return candidate && videoIdPattern.test(candidate) ? candidate : null;
}
