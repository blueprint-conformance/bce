import * as fs from 'node:fs';
import * as path from 'node:path';

const encodePath = value => value.split('/').map(encodeURIComponent).join('/');
// Keep legal/security notices at their canonical public paths. Their explicitly scoped
// disclosure exceptions do not extend to newly generated copies under the site tree.
const canonicalNotices = new Set(['GOVERNANCE.md', 'SECURITY.md', 'TRADEMARKS.md']);

/** Publish plain-text documentation with links that resolve from an HTTP reader's location. */
export function publishAgentDocs({ repoRoot, outDir, sources, origin, repository }) {
  const pending = [...new Set(['llms.txt', ...sources])];
  const published = new Set();
  const root = fs.realpathSync(repoRoot);
  const safeFile = relative => {
    const absolute = path.resolve(root, relative);
    const real = fs.realpathSync(absolute);
    if (!real.startsWith(root + path.sep) || !fs.statSync(real).isFile()) {
      throw new Error(`agent documentation source escapes repository or is not a file: ${relative}`);
    }
    return real;
  };
  for (let i = 0; i < pending.length; i++) {
    const source = pending[i];
    if (published.has(source)) continue;
    const content = fs.readFileSync(safeFile(source), 'utf8');
    const targetUrl = target => {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) return target;
      // GitHub's repository-relative issue links are navigation, not filesystem reads.
      if (/^\.\.\/\.\.\/(?:issues|pulls)(?:[/?#]|$)/.test(target)) {
        return `https://github.com/${repository}/${target.slice(6)}`;
      }
      const [bare, fragment = ''] = target.split('#');
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(source), decodeURIComponent(bare)));
      if (relative === '..' || relative.startsWith('../') || path.posix.isAbsolute(relative) || relative.includes('\\')) {
        throw new Error(`agent documentation link escapes repository: ${source} -> ${target}`);
      }
      const absolute = path.join(root, relative);
      const suffix = fragment ? `#${fragment}` : '';
      if (!canonicalNotices.has(relative) && (/\.md$/i.test(relative) || relative === 'llms.txt') && fs.existsSync(absolute)) {
        safeFile(relative);
        if (!published.has(relative)) pending.push(relative);
        return `${origin}/source/${encodePath(relative)}${suffix}`;
      }
      // Code, schema, asset and directory links remain on their public source host.
      // Unmapped historical references are preserved as source links, not invented site routes.
      const directory = fs.existsSync(absolute) && fs.statSync(absolute).isDirectory();
      return directory
        ? `https://github.com/${repository}/tree/main/${encodePath(relative)}${suffix}`
        : `https://raw.githubusercontent.com/${repository}/main/${encodePath(relative)}${suffix}`;
    };
    let fence;
    const markdown = content.split('\n').map(line => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker) {
        if (!fence) fence = marker;
        else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
        return line;
      }
      if (fence) return line;
      return line.replace(/(`+)[^`]*?\1|(\[[^\]\n]*\]\()([^\s)]+)(\))/g,
        (all, code, before, target, after) => code ? all : `${before}${targetUrl(target)}${after}`)
        .replace(/((?:href|src|srcset)=")([^"\s]+)(")/g, (_all, before, target, after) => `${before}${targetUrl(target)}${after}`);
    }).join('\n');
    const destination = path.join(outDir, 'source', source);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, markdown);
    if (source === 'llms.txt') fs.writeFileSync(path.join(outDir, 'llms.txt'), markdown);
    published.add(source);
  }
  return [...published].sort();
}
