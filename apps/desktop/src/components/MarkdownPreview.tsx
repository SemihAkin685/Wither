import { useDeferredValue, useMemo, useRef, type ReactNode } from "react";
import { inlineText, parseMarkdown, slugify, type Block, type Inline } from "../lib/markdown";
import { useWorkspaceImage } from "./ImagePreview";

interface MarkdownPreviewProps {
  path: string;
  content: string;
  /** Workspace file paths, relative links into the project open in the editor. */
  files: Record<string, unknown>;
  onOpenFile: (path: string) => void;
}

/** Resolves `href` against the folder of `from`, workspace style (no leading slash). */
function resolvePath(from: string, href: string): string | null {
  let clean: string;
  try {
    clean = decodeURI(href.split(/[?#]/)[0]);
  } catch {
    return null;
  }
  if (!clean) return null;
  const parts = clean.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const part of clean.split("/")) {
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

const isExternal = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href);

interface RenderContext {
  path: string;
  files: Record<string, unknown>;
  onOpenFile: (path: string) => void;
  scrollTo: (id: string) => void;
}

function WorkspaceImage({ path, alt }: { path: string; alt: string }) {
  const image = useWorkspaceImage(path);
  if (image.status !== "ready") return <span className="markdown-image-missing">{alt || path}</span>;
  return <img src={image.url} alt={alt} />;
}

function renderInline(nodes: Inline[], ctx: RenderContext): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.kind) {
      case "text":
        return node.text;
      case "code":
        return <code key={i}>{node.text}</code>;
      case "strong":
        return <strong key={i}>{renderInline(node.children, ctx)}</strong>;
      case "em":
        return <em key={i}>{renderInline(node.children, ctx)}</em>;
      case "del":
        return <del key={i}>{renderInline(node.children, ctx)}</del>;
      case "break":
        return <br key={i} />;
      case "image": {
        // remote images stay out, the preview shouldn't phone home just because a README was opened
        const target = isExternal(node.src) ? null : resolvePath(ctx.path, node.src);
        return target && target in ctx.files ? (
          <WorkspaceImage key={i} path={target} alt={node.alt} />
        ) : (
          <span key={i} className="markdown-image-missing" title={node.src}>
            {node.alt || node.src}
          </span>
        );
      }
      case "link": {
        const { href } = node;
        const target = href.startsWith("#") || isExternal(href) ? null : resolvePath(ctx.path, href);
        const opens = href.startsWith("#") || (target !== null && target in ctx.files);
        // links never navigate the webview, that would replace the whole app, and only
        // ones we handle get an href so a javascript: url never ends up on an element
        return (
          <a
            key={i}
            href={opens ? href : undefined}
            title={href}
            className={opens ? undefined : "is-inert"}
            onClick={(e) => {
              e.preventDefault();
              if (href.startsWith("#")) ctx.scrollTo(href.slice(1));
              else if (target !== null && target in ctx.files) ctx.onOpenFile(target);
            }}
          >
            {renderInline(node.children, ctx)}
          </a>
        );
      }
    }
  });
}

function renderBlocks(blocks: Block[], ctx: RenderContext): ReactNode[] {
  return blocks.map((block, i) => {
    switch (block.kind) {
      case "heading": {
        const Tag = `h${block.level}` as "h1";
        return (
          <Tag key={i} id={slugify(inlineText(block.content))}>
            {renderInline(block.content, ctx)}
          </Tag>
        );
      }
      case "paragraph":
        return <p key={i}>{renderInline(block.content, ctx)}</p>;
      case "code":
        return (
          <pre key={i} data-lang={block.lang || undefined}>
            <code>{block.text}</code>
          </pre>
        );
      case "quote":
        return <blockquote key={i}>{renderBlocks(block.children, ctx)}</blockquote>;
      case "rule":
        return <hr key={i} />;
      case "list": {
        const items = block.items.map((item, j) => (
          <li key={j} className={item.checked === undefined ? undefined : "is-task"}>
            {item.checked !== undefined && <input type="checkbox" checked={item.checked} readOnly tabIndex={-1} />}
            {/* tight items are a single paragraph, unwrap it so bullets don't get paragraph margins */}
            {item.children.length === 1 && item.children[0].kind === "paragraph"
              ? renderInline(item.children[0].content, ctx)
              : renderBlocks(item.children, ctx)}
          </li>
        ));
        return block.ordered ? (
          <ol key={i} start={block.start === 1 ? undefined : block.start}>
            {items}
          </ol>
        ) : (
          <ul key={i}>{items}</ul>
        );
      }
      case "table":
        return (
          <div key={i} className="markdown-table">
            <table>
              <thead>
                <tr>
                  {block.head.map((cell, j) => (
                    <th key={j} style={{ textAlign: block.align[j] ?? undefined }}>
                      {renderInline(cell, ctx)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {block.head.map((_, j) => (
                      <td key={j} style={{ textAlign: block.align[j] ?? undefined }}>
                        {row[j] ? renderInline(row[j], ctx) : null}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

/** Rendered view of a Markdown file, kept next to the editor and updated as you type. */
export function MarkdownPreview({ path, content, files, onOpenFile }: MarkdownPreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  // parsing a long README on every keystroke is fine, but let typing win if it ever isn't
  const deferred = useDeferredValue(content);
  const blocks = useMemo(() => parseMarkdown(deferred), [deferred]);
  const ctx: RenderContext = {
    path,
    files,
    onOpenFile,
    scrollTo: (id) => rootRef.current?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start" }),
  };
  return (
    <div className="markdown-preview" ref={rootRef}>
      <article className="markdown-body">{renderBlocks(blocks, ctx)}</article>
    </div>
  );
}
