import fontCss from '../fonts.css?inline';

let embedded: Promise<string> | undefined;
/** SVG images cannot load external fonts. Embed local font files for preview and PNG parity. */
export function loadRecapFonts(): Promise<string> {
  if (!embedded) embedded = (async () => {
    const urls = [...new Set([...fontCss.matchAll(/url\(([^)]+)\)/g)].map((match) => match[1].replace(/^['"]|['"]$/g, '')))];
    let css = fontCss;
    await Promise.all(urls.map(async (url) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Could not load the card font. Refresh to retry.');
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject;
        response.blob().then((blob) => reader.readAsDataURL(blob), reject);
      });
      css = css.split(url).join(data);
    }));
    return css;
  })().catch((error) => { embedded = undefined; throw error; });
  return embedded;
}
