/**
 * A minified production bundle with a source map, for tests that recover
 * component names and definitions. A stand-in React module keeps real call
 * shapes (`memo(...)`, `forwardRef(...)`, `class extends Component`) without
 * bundling React.
 */
import { build, type Plugin } from 'esbuild';

const FAKE_REACT = `
export class Component { constructor(props) { this.props = props; } }
export function memo(type) { return { $$typeof: Symbol.for('react.memo'), type }; }
export function forwardRef(render) { return { $$typeof: Symbol.for('react.forward_ref'), render }; }
export function useState(value) { return [value, () => {}]; }
export function jsx(type, props) { return { type, props }; }
export const jsxs = jsx;
export const Fragment = Symbol.for("react.fragment");
`;

/** Authored source; line numbers are asserted by tests. */
export const MINIFIED_APP_SOURCE = `
import { Component, forwardRef, memo, useState } from 'react';
export function ProjectList({ items }) {
  const [count] = useState(items.length);
  return items.map((item) => <ProjectRow key={item} label={item} count={count} />);
}
const ProjectRow = ({ label }) => <li data-testid="row">{label}</li>;
export const MemoCard = memo(function Card({ title }) { return <div className="card">{title}</div>; });
export const Fancy = forwardRef((props, ref) => <span ref={ref}>fancy {props.label}</span>);
export class Boundary extends Component { render() { return this.props.children ?? null; } }
export const AnonymousMemo = memo(({ value }) => <b>{value * 2}</b>);
export { ProjectRow };
`;

/**
 * Components in separate scopes that the minifier mangles to identical text.
 * `StarIcon` and `HeartIcon` share text but not a name; the two `Badge`
 * definitions share both. `Toolbar` renders `StarIcon`, `Favorites` renders
 * `HeartIcon` through `Wrapper`'s children, and `Both` renders both.
 */
export const DUPLICATE_TEXT_SOURCE = `
function starScope() { function StarIcon(props) { return <i {...props} />; } return StarIcon; }
function heartScope() { function HeartIcon(props) { return <i {...props} />; } return HeartIcon; }
function badgeScope() { function Badge(props) { return <b {...props} />; } return Badge; }
function badgeCopy() { function Badge(props) { return <b {...props} />; } return Badge; }
export const StarIcon = starScope();
export const HeartIcon = heartScope();
export const Badge = badgeScope();
export const BadgeCopy = badgeCopy();
function Wrapper({ children }) { return <div className="wrap">{children}</div>; }
export function Toolbar() { return <nav data-testid="toolbar"><StarIcon /></nav>; }
export function Favorites() { return <section><Wrapper><HeartIcon /></Wrapper></section>; }
export function Both() { return <p><StarIcon /><HeartIcon /></p>; }
export { Wrapper };
`;

const fakeReact: Plugin = {
  name: 'fake-react',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, (args) => ({ path: args.path, namespace: 'fake-react' }));
    pluginBuild.onLoad({ filter: /.*/, namespace: 'fake-react' }, () => ({ contents: FAKE_REACT, loader: 'js' }));
  },
};

export type MinifiedBundle = {
  /** Bundle text; `linked` points at `<outfile>.map`, `inline` embeds it. */
  code: string;
  map: string;
  /** The bundle's exports, evaluated so function text matches `code`. */
  exports: Record<string, unknown>;
};

/** Build `source` minified, with a linked or inline source map. Requires a Node test environment. */
export async function buildMinifiedBundle(
  sourcemap: 'linked' | 'inline' = 'linked',
  outfile = 'index-3f9a.js',
  source = MINIFIED_APP_SOURCE,
): Promise<MinifiedBundle> {
  const result = await build({
    stdin: { contents: source, sourcefile: 'src/app.jsx', loader: 'jsx', resolveDir: process.cwd() },
    bundle: true,
    minify: true,
    format: 'iife',
    globalName: '__app',
    jsx: 'automatic',
    sourcemap,
    write: false,
    outfile,
    plugins: [fakeReact],
  });
  const js = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  const code = sourcemap === 'linked'
    ? js.replace(/\/\/# sourceMappingURL=.*$/m, `//# sourceMappingURL=${outfile}.map`)
    : js;
  const map = result.outputFiles.find((file) => file.path.endsWith('.map'))?.text ?? '';
  const exports = new Function(`${code}; return __app;`)() as Record<string, unknown>;
  return { code, map, exports };
}
