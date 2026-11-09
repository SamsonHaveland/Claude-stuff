import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Agent replies are Markdown (Claude-style). Rendered safely:
 *  - raw HTML in replies is NOT rendered (react-markdown default; no rehype-raw)
 *  - links: only http(s) and mailto survive; open in a new tab without referrer
 *  - remote images are shown as links (the app's CSP blocks third-party images anyway)
 *  - Hermes' "MEDIA:<url>" image tags become a tappable "Open image" link
 */
const SAFE = /^(https?:|mailto:)/i;
const urlTransform = (url: string) => (SAFE.test(url) ? defaultUrlTransform(url) : '');

function preprocess(text: string) {
  return text.replace(/(^|\s)MEDIA:(\S+)/g, (_m, pre, src) =>
    /^https:\/\//.test(src) ? `${pre}[Open image](${src})` : `${pre}_(image saved on the Pi)_`);
}

const components: Components = {
  a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
  img: ({ src, alt }) => (typeof src === 'string' && src ? <a href={src} target="_blank" rel="noopener noreferrer">{alt || 'Open image'}</a> : null),
  table: ({ children }) => <div className="md-table"><table>{children}</table></div>,
  input: ({ checked }) => <span aria-hidden className="md-check">{checked ? '☑' : '☐'}</span>,
};

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={urlTransform} components={components}>
        {preprocess(text)}
      </ReactMarkdown>
    </div>
  );
}
